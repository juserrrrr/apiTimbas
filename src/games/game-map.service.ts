import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SettingsService } from '../settings/settings.service';
import {
  FloorFinish,
  GameMap,
  OFFICE_MAP,
  PropDef,
  PropKind,
  Rect,
  RoomDef,
  RoomKind,
  Side,
  StairDef,
  TaskKind,
  TaskSpot,
  VentDef,
  buildObstacles,
  buildStairBarriers,
  buildTerrainObstacles,
  buildWalls,
} from './deducao/map';

const LEGACY_MAP_KEY = 'games.deducao.map.v1';
const MAPS_KEY = 'games.deducao.maps.v2';
export const ORIGINAL_MAP_ID = 'original';

interface StoredGameMap {
  id: string;
  map: GameMap;
  createdAt: string;
  updatedAt: string;
}

export interface GameMapSummary {
  id: string;
  name: string;
  original: boolean;
  updatedAt: string | null;
}

export interface GameMapEntry extends GameMapSummary {
  map: GameMap;
}
const FINISHES = new Set<FloorFinish>([
  'carpet',
  'patternedCarpet',
  'wood',
  'parquet',
  'server',
  'terrazzo',
  'vinyl',
  'pantry',
  'concrete',
  'grass',
  'water',
  'sport',
  'asphalt',
]);
const ROOM_KINDS = new Set<RoomKind>([
  'sala',
  'corredor',
  'terraco',
  'externa',
  'agua',
  'campo',
]);
const SIDES = new Set<Side>(['north', 'south', 'east', 'west']);
const PROP_KINDS = new Set<PropKind>([
  'desk',
  'chair',
  'monitor',
  'plant',
  'sofa',
  'counter',
  'meetingTable',
  'cafeTable',
  'rack',
  'locker',
  'shelf',
  'coffee',
  'crate',
  'printer',
  'whiteboard',
  'car',
  'cone',
  'sink',
  'vending',
  'kitchen',
  'tree',
  'streetLamp',
  'bench',
]);
const TASK_KINDS = new Set<TaskKind>([
  'rack',
  'arquivo',
  'senha',
  'cafe',
  'cabos',
  'impressora',
  'estoque',
]);

type UnknownRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new BadRequestException(`Mapa inválido: ${message}`);
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${label} precisa ser um objeto.`);
  return value as UnknownRecord;
}

function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(`${label} precisa ser uma lista.`);
  if (value.length > max) fail(`${label} excede o limite de ${max} itens.`);
  return value;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim())
    fail(`${label} é obrigatório.`);
  return value.trim().slice(0, max);
}

function numberValue(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max)
    fail(`${label} precisa ficar entre ${min} e ${max}.`);
  return Math.round(parsed * 100) / 100;
}

function angleValue(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${label} precisa ser um ângulo válido.`);
  return Math.round(Math.atan2(Math.sin(parsed), Math.cos(parsed)) * 100) / 100;
}

function levelValue(value: unknown, label: string): number {
  const parsed = numberValue(value ?? 0, label, 0, 1);
  if (!Number.isInteger(parsed)) fail(`${label} precisa ser 0 ou 1.`);
  return parsed;
}

function idValue(value: unknown, label: string): string {
  const id = text(value, label, 48);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    fail(`${label} aceita apenas letras minúsculas, números e hífen.`);
  return id;
}

function colorValue(value: unknown, label: string): string {
  const color = text(value, label, 7);
  if (!/^#[0-9a-f]{6}$/i.test(color))
    fail(`${label} precisa ser uma cor hexadecimal completa.`);
  return color.toLowerCase();
}

function rectValue(value: unknown, label: string, minSize = 2): Rect {
  const item = record(value, label);
  return {
    x: numberValue(item.x, `${label}.x`, -500, 500),
    z: numberValue(item.z, `${label}.z`, -500, 500),
    w: numberValue(item.w, `${label}.w`, minSize, 250),
    d: numberValue(item.d, `${label}.d`, minSize, 250),
  };
}

function insideBounds(point: { x: number; z: number }, bounds: Rect): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.w &&
    point.z >= bounds.z &&
    point.z <= bounds.z + bounds.d
  );
}

function roomContaining(
  rooms: RoomDef[],
  point: { x: number; z: number; level?: number },
): RoomDef | undefined {
  const level = point.level ?? 0;
  return rooms.find(
    (room) =>
      (room.level ?? 0) === level &&
      point.x >= room.rect.x &&
      point.x <= room.rect.x + room.rect.w &&
      point.z >= room.rect.z &&
      point.z <= room.rect.z + room.rect.d,
  );
}

function insideRoom(
  room: RoomDef,
  point: { x: number; z: number; level?: number },
): boolean {
  return (
    (room.level ?? 0) === (point.level ?? 0) &&
    point.x >= room.rect.x &&
    point.x <= room.rect.x + room.rect.w &&
    point.z >= room.rect.z &&
    point.z <= room.rect.z + room.rect.d
  );
}

@Injectable()
export class GameMapService {
  private readonly logger = new Logger(GameMapService.name);
  private cache: StoredGameMap[] | null = null;

  constructor(private readonly settings: SettingsService) {}

  async list(): Promise<GameMapSummary[]> {
    const stored = [...(await this.storedMaps())];
    return [
      {
        id: ORIGINAL_MAP_ID,
        name: OFFICE_MAP.name,
        original: true,
        updatedAt: null,
      },
      ...stored.map((entry) => ({
        id: entry.id,
        name: entry.map.name,
        original: false,
        updatedAt: entry.updatedAt,
      })),
    ];
  }

  async get(id = ORIGINAL_MAP_ID): Promise<GameMapEntry> {
    if (!id || id === ORIGINAL_MAP_ID) {
      return {
        id: ORIGINAL_MAP_ID,
        name: OFFICE_MAP.name,
        original: true,
        updatedAt: null,
        map: OFFICE_MAP,
      };
    }
    const entry = (await this.storedMaps()).find(
      (candidate) => candidate.id === id,
    );
    if (!entry) throw new NotFoundException('Esse mapa não existe mais.');
    return {
      id: entry.id,
      name: entry.map.name,
      original: false,
      updatedAt: entry.updatedAt,
      map: entry.map,
    };
  }

  async current(): Promise<GameMap> {
    return (await this.get()).map;
  }

  async create(value: unknown): Promise<GameMapEntry> {
    const map = this.normalize(value);
    const now = new Date().toISOString();
    const entry: StoredGameMap = {
      id: randomUUID(),
      map,
      createdAt: now,
      updatedAt: now,
    };
    const stored = [...(await this.storedMaps())];
    if (stored.length >= 40)
      throw new BadRequestException(
        'A biblioteca chegou ao limite de 40 mapas personalizados.',
      );
    stored.push(entry);
    await this.save(stored);
    return { ...entry, name: map.name, original: false };
  }

  async update(id: string, value: unknown): Promise<GameMapEntry> {
    if (id === ORIGINAL_MAP_ID)
      throw new BadRequestException(
        'O mapa original é fixo. Crie uma cópia para editar.',
      );
    const map = this.normalize(value);
    const stored = [...(await this.storedMaps())];
    const index = stored.findIndex((entry) => entry.id === id);
    if (index < 0) throw new NotFoundException('Esse mapa não existe mais.');
    stored[index] = {
      ...stored[index],
      map,
      updatedAt: new Date().toISOString(),
    };
    await this.save(stored);
    return { ...stored[index], name: map.name, original: false };
  }

  async delete(id: string): Promise<void> {
    if (id === ORIGINAL_MAP_ID)
      throw new BadRequestException('O mapa original não pode ser removido.');
    const stored = await this.storedMaps();
    const next = stored.filter((entry) => entry.id !== id);
    if (next.length === stored.length)
      throw new NotFoundException('Esse mapa não existe mais.');
    await this.save(next);
  }

  async publish(value: unknown): Promise<GameMap> {
    return (await this.create(value)).map;
  }

  private async storedMaps(): Promise<StoredGameMap[]> {
    if (this.cache) return this.cache;
    const values = await this.settings.getMany([MAPS_KEY, LEGACY_MAP_KEY]);
    const rawLibrary = values.get(MAPS_KEY);
    if (rawLibrary) {
      try {
        const parsed = JSON.parse(rawLibrary) as unknown;
        if (!Array.isArray(parsed))
          throw new Error('a biblioteca não é uma lista');
        const library = parsed.slice(0, 40).flatMap((raw): StoredGameMap[] => {
          if (!raw || typeof raw !== 'object') return [];
          const candidate = raw as Partial<StoredGameMap>;
          if (
            typeof candidate.id !== 'string' ||
            !candidate.id ||
            !candidate.map
          )
            return [];
          try {
            return [
              {
                id: candidate.id.slice(0, 64),
                map: this.normalize(candidate.map),
                createdAt:
                  typeof candidate.createdAt === 'string'
                    ? candidate.createdAt
                    : new Date(0).toISOString(),
                updatedAt:
                  typeof candidate.updatedAt === 'string'
                    ? candidate.updatedAt
                    : new Date(0).toISOString(),
              },
            ];
          } catch (error) {
            this.logger.warn(
              `Mapa ${candidate.id} ignorado: ${error instanceof Error ? error.message : 'conteúdo inválido'}`,
            );
            return [];
          }
        });
        this.cache = library;
        return library;
      } catch (error) {
        this.logger.warn(
          `Biblioteca de mapas ignorada: ${error instanceof Error ? error.message : 'conteúdo inválido'}`,
        );
      }
    }

    const legacy = values.get(LEGACY_MAP_KEY);
    if (!legacy) {
      this.cache = [];
      return this.cache;
    }
    try {
      const now = new Date().toISOString();
      this.cache = [
        {
          id: 'mapa-migrado',
          map: this.normalize(JSON.parse(legacy)),
          createdAt: now,
          updatedAt: now,
        },
      ];
      return this.cache;
    } catch (error) {
      this.logger.warn(
        `Mapa antigo ignorado: ${error instanceof Error ? error.message : 'conteúdo inválido'}`,
      );
      this.cache = [];
      return this.cache;
    }
  }

  private async save(entries: StoredGameMap[]) {
    await this.settings.set(MAPS_KEY, JSON.stringify(entries));
    await this.settings.remove([LEGACY_MAP_KEY]);
    this.cache = entries;
  }

  normalize(value: unknown): GameMap {
    const source = record(value, 'raiz');
    const name = text(source.name, 'nome', 64);
    const bounds = rectValue(source.bounds, 'limites', 10);
    const roomIds = new Set<string>();
    const rooms = list(source.rooms, 'salas', 80).map((raw, index): RoomDef => {
      const item = record(raw, `salas[${index}]`);
      const id = idValue(item.id, `salas[${index}].id`);
      if (roomIds.has(id)) fail(`a sala ${id} aparece mais de uma vez.`);
      roomIds.add(id);
      const rect = rectValue(item.rect, `salas[${index}].rect`);
      if (
        !insideBounds(rect, bounds) ||
        !insideBounds({ x: rect.x + rect.w, z: rect.z + rect.d }, bounds)
      ) {
        fail(`a sala ${id} ultrapassa os limites do mapa.`);
      }
      const kind = text(item.kind, `salas[${index}].kind`, 16) as RoomKind;
      if (!ROOM_KINDS.has(kind)) fail(`tipo desconhecido na sala ${id}.`);
      const finish = text(
        item.finish ?? 'terrazzo',
        `salas[${index}].finish`,
        32,
      ) as FloorFinish;
      if (!FINISHES.has(finish)) fail(`piso desconhecido na sala ${id}.`);
      const doors = list(item.doors ?? [], `salas[${index}].doors`, 16).map(
        (rawDoor, doorIndex) => {
          const door = record(rawDoor, `salas[${index}].doors[${doorIndex}]`);
          const side = text(
            door.side,
            `porta ${doorIndex} da sala ${id}`,
            8,
          ) as Side;
          if (!SIDES.has(side))
            fail(`lado inválido na porta ${doorIndex} da sala ${id}.`);
          const width = numberValue(
            door.width,
            `largura da porta ${doorIndex}`,
            1.2,
            6,
          );
          const length = side === 'north' || side === 'south' ? rect.w : rect.d;
          const at = numberValue(
            door.at,
            `posição da porta ${doorIndex}`,
            0,
            length - width,
          );
          return { side, width, at };
        },
      );
      return {
        id,
        name: text(item.name, `nome da sala ${id}`, 48),
        rect,
        kind,
        level: levelValue(item.level, `andar da sala ${id}`),
        floor: colorValue(item.floor ?? '#8794a5', `cor do piso da sala ${id}`),
        finish,
        light: colorValue(item.light ?? '#60a5fa', `cor da luz da sala ${id}`),
        doors,
      };
    });
    if (rooms.length === 0) fail('adicione pelo menos uma sala.');

    const props = list(source.props ?? [], 'objetos', 500).map(
      (raw, index): PropDef => {
        const item = record(raw, `objetos[${index}]`);
        const kind = text(item.kind, `objetos[${index}].kind`, 32) as PropKind;
        if (!PROP_KINDS.has(kind)) fail(`objeto desconhecido: ${kind}.`);
        const prop = {
          kind,
          x: numberValue(
            item.x,
            `objetos[${index}].x`,
            bounds.x,
            bounds.x + bounds.w,
          ),
          z: numberValue(
            item.z,
            `objetos[${index}].z`,
            bounds.z,
            bounds.z + bounds.d,
          ),
          rot: angleValue(item.rot ?? 0, `objetos[${index}].rot`),
          level: levelValue(item.level, `objetos[${index}].level`),
        };
        if (!roomContaining(rooms, prop))
          fail(`o objeto ${index} está fora de uma sala.`);
        return prop;
      },
    );

    const taskIds = new Set<string>();
    const taskSpots = list(source.taskSpots, 'tarefas', 200).map(
      (raw, index): TaskSpot => {
        const item = record(raw, `tarefas[${index}]`);
        const id = idValue(item.id, `tarefas[${index}].id`);
        if (taskIds.has(id)) fail(`a tarefa ${id} aparece mais de uma vez.`);
        taskIds.add(id);
        const kind = text(item.kind, `tarefas[${index}].kind`, 24) as TaskKind;
        if (!TASK_KINDS.has(kind))
          fail(`tipo de tarefa desconhecido: ${kind}.`);
        const spot = {
          id,
          kind,
          room: idValue(item.room, `sala da tarefa ${id}`),
          label: text(item.label, `nome da tarefa ${id}`, 80),
          x: numberValue(
            item.x,
            `tarefas[${index}].x`,
            bounds.x,
            bounds.x + bounds.w,
          ),
          z: numberValue(
            item.z,
            `tarefas[${index}].z`,
            bounds.z,
            bounds.z + bounds.d,
          ),
          level: levelValue(item.level, `tarefas[${index}].level`),
        };
        const room = rooms.find((candidate) => candidate.id === spot.room);
        if (!room || !insideRoom(room, spot))
          fail(`a tarefa ${id} não está dentro da sala informada.`);
        return spot;
      },
    );
    if (taskSpots.length < 4)
      fail('adicione pelo menos quatro pontos de tarefa.');

    const ventIds = new Set<string>();
    const vents = list(source.vents ?? [], 'dutos', 50).map(
      (raw, index): VentDef => {
        const item = record(raw, `dutos[${index}]`);
        const id = idValue(item.id, `dutos[${index}].id`);
        if (ventIds.has(id)) fail(`o duto ${id} aparece mais de uma vez.`);
        ventIds.add(id);
        const vent = {
          id,
          room: idValue(item.room, `sala do duto ${id}`),
          x: numberValue(
            item.x,
            `dutos[${index}].x`,
            bounds.x,
            bounds.x + bounds.w,
          ),
          z: numberValue(
            item.z,
            `dutos[${index}].z`,
            bounds.z,
            bounds.z + bounds.d,
          ),
          links: list(item.links ?? [], `ligações do duto ${id}`, 8).map(
            (link) => idValue(link, `ligação do duto ${id}`),
          ),
          level: levelValue(item.level, `dutos[${index}].level`),
        };
        const room = rooms.find((candidate) => candidate.id === vent.room);
        if (!room || !insideRoom(room, vent))
          fail(`o duto ${id} não está dentro da sala informada.`);
        return vent;
      },
    );
    for (const vent of vents) {
      for (const link of vent.links)
        if (!ventIds.has(link))
          fail(`o duto ${vent.id} aponta para ${link}, que não existe.`);
    }

    const stairs = list(source.stairs ?? [], 'escadas', 20).map(
      (raw, index): StairDef => {
        const item = record(raw, `escadas[${index}]`);
        const stair = {
          id: idValue(item.id, `escadas[${index}].id`),
          level: levelValue(item.level, `escadas[${index}].level`),
          x: numberValue(
            item.x,
            `escadas[${index}].x`,
            bounds.x,
            bounds.x + bounds.w,
          ),
          z: numberValue(
            item.z,
            `escadas[${index}].z`,
            bounds.z,
            bounds.z + bounds.d,
          ),
          rot: angleValue(item.rot ?? 0, `escadas[${index}].rot`),
          targetLevel: levelValue(
            item.targetLevel,
            `escadas[${index}].targetLevel`,
          ),
          targetX: numberValue(
            item.targetX,
            `escadas[${index}].targetX`,
            bounds.x,
            bounds.x + bounds.w,
          ),
          targetZ: numberValue(
            item.targetZ,
            `escadas[${index}].targetZ`,
            bounds.z,
            bounds.z + bounds.d,
          ),
        };
        if (stair.level === stair.targetLevel)
          fail(`a escada ${stair.id} precisa ligar andares diferentes.`);
        return stair;
      },
    );
    if (
      rooms.some((room) => room.level === 1) &&
      !stairs.some((stair) => stair.targetLevel > stair.level)
    ) {
      fail('o segundo andar precisa de pelo menos uma escada de subida.');
    }

    const point = (raw: unknown, label: string) => {
      const item = record(raw, label);
      const result = {
        x: numberValue(item.x, `${label}.x`, bounds.x, bounds.x + bounds.w),
        z: numberValue(item.z, `${label}.z`, bounds.z, bounds.z + bounds.d),
        level: levelValue(item.level, `${label}.level`),
      };
      if (!roomContaining(rooms, result))
        fail(`${label} está fora de uma sala.`);
      return result;
    };
    const emergency = point(source.emergency, 'mesa de emergência');
    const spawns = list(source.spawns, 'pontos de entrada', 24).map(
      (raw, index) => point(raw, `entrada ${index + 1}`),
    );
    if (spawns.length < 4)
      fail('adicione pelo menos quatro pontos de entrada.');
    const meetingSeats = list(
      source.meetingSeats,
      'lugares da reunião',
      16,
    ).map((raw, index) => {
      const seat = record(raw, `lugar da reunião ${index + 1}`);
      return {
        ...point(seat, `lugar da reunião ${index + 1}`),
        dir: angleValue(seat.dir ?? 0, `direção do lugar ${index + 1}`),
      };
    });
    if (meetingSeats.length < 4)
      fail('adicione pelo menos quatro lugares para a reunião.');

    const sourceMeta =
      source.source && typeof source.source === 'object'
        ? record(source.source, 'origem')
        : null;
    const normalizedSource = sourceMeta
      ? {
          label:
            typeof sourceMeta.label === 'string'
              ? sourceMeta.label.slice(0, 100)
              : undefined,
          referenceUrl:
            typeof sourceMeta.referenceUrl === 'string' &&
            /^https:\/\//.test(sourceMeta.referenceUrl)
              ? sourceMeta.referenceUrl.slice(0, 500)
              : undefined,
          latitude:
            sourceMeta.latitude === undefined
              ? undefined
              : numberValue(sourceMeta.latitude, 'latitude', -90, 90),
          longitude:
            sourceMeta.longitude === undefined
              ? undefined
              : numberValue(sourceMeta.longitude, 'longitude', -180, 180),
          gameUnitsPerMeter:
            sourceMeta.gameUnitsPerMeter === undefined
              ? undefined
              : numberValue(sourceMeta.gameUnitsPerMeter, 'escala', 0.05, 4),
        }
      : undefined;

    return {
      name,
      bounds,
      rooms,
      walls: buildWalls(rooms),
      obstacles: [
        ...buildObstacles(props),
        ...buildStairBarriers(stairs),
        ...buildTerrainObstacles(rooms),
      ],
      props,
      taskSpots,
      vents,
      stairs,
      emergency,
      spawns,
      meetingSeats,
      ...(normalizedSource ? { source: normalizedSource } : {}),
    };
  }
}
