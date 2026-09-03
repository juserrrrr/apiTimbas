import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
  buildWalls,
} from './deducao/map';

const MAP_KEY = 'games.deducao.map.v1';
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
]);
const ROOM_KINDS = new Set<RoomKind>(['sala', 'corredor', 'terraco']);
const SIDES = new Set<Side>(['north', 'south', 'east', 'west']);
const PROP_KINDS = new Set<PropKind>([
  'desk', 'chair', 'monitor', 'plant', 'sofa', 'counter', 'meetingTable', 'cafeTable',
  'rack', 'locker', 'shelf', 'coffee', 'crate', 'printer', 'whiteboard', 'car', 'cone',
  'sink', 'vending', 'kitchen',
]);
const TASK_KINDS = new Set<TaskKind>(['rack', 'arquivo', 'senha', 'cafe', 'cabos', 'impressora', 'estoque']);

type UnknownRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new BadRequestException(`Mapa inválido: ${message}`);
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} precisa ser um objeto.`);
  return value as UnknownRecord;
}

function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(`${label} precisa ser uma lista.`);
  if (value.length > max) fail(`${label} excede o limite de ${max} itens.`);
  return value;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} é obrigatório.`);
  return value.trim().slice(0, max);
}

function numberValue(value: unknown, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) fail(`${label} precisa ficar entre ${min} e ${max}.`);
  return Math.round(parsed * 100) / 100;
}

function levelValue(value: unknown, label: string): number {
  const parsed = numberValue(value ?? 0, label, 0, 1);
  if (!Number.isInteger(parsed)) fail(`${label} precisa ser 0 ou 1.`);
  return parsed;
}

function idValue(value: unknown, label: string): string {
  const id = text(value, label, 48);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(`${label} aceita apenas letras minúsculas, números e hífen.`);
  return id;
}

function colorValue(value: unknown, label: string): string {
  const color = text(value, label, 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) fail(`${label} precisa ser uma cor hexadecimal completa.`);
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
  return point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.z >= bounds.z && point.z <= bounds.z + bounds.d;
}

function roomContaining(rooms: RoomDef[], point: { x: number; z: number; level?: number }): RoomDef | undefined {
  const level = point.level ?? 0;
  return rooms.find((room) =>
    (room.level ?? 0) === level &&
    point.x >= room.rect.x && point.x <= room.rect.x + room.rect.w &&
    point.z >= room.rect.z && point.z <= room.rect.z + room.rect.d,
  );
}

function insideRoom(room: RoomDef, point: { x: number; z: number; level?: number }): boolean {
  return (
    (room.level ?? 0) === (point.level ?? 0) &&
    point.x >= room.rect.x && point.x <= room.rect.x + room.rect.w &&
    point.z >= room.rect.z && point.z <= room.rect.z + room.rect.d
  );
}

@Injectable()
export class GameMapService {
  private readonly logger = new Logger(GameMapService.name);

  constructor(private readonly settings: SettingsService) {}

  async current(): Promise<GameMap> {
    try {
      const stored = (await this.settings.getMany([MAP_KEY])).get(MAP_KEY);
      return stored ? this.normalize(JSON.parse(stored)) : OFFICE_MAP;
    } catch (error) {
      this.logger.warn(`Mapa salvo ignorado: ${error instanceof Error ? error.message : 'conteúdo inválido'}`);
      return OFFICE_MAP;
    }
  }

  async publish(value: unknown): Promise<GameMap> {
    const map = this.normalize(value);
    await this.settings.set(MAP_KEY, JSON.stringify(map));
    return map;
  }

  async reset(): Promise<GameMap> {
    await this.settings.remove([MAP_KEY]);
    return OFFICE_MAP;
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
      if (!insideBounds(rect, bounds) || !insideBounds({ x: rect.x + rect.w, z: rect.z + rect.d }, bounds)) {
        fail(`a sala ${id} ultrapassa os limites do mapa.`);
      }
      const kind = text(item.kind, `salas[${index}].kind`, 16) as RoomKind;
      if (!ROOM_KINDS.has(kind)) fail(`tipo desconhecido na sala ${id}.`);
      const finish = text(item.finish ?? 'terrazzo', `salas[${index}].finish`, 32) as FloorFinish;
      if (!FINISHES.has(finish)) fail(`piso desconhecido na sala ${id}.`);
      const doors = list(item.doors ?? [], `salas[${index}].doors`, 16).map((rawDoor, doorIndex) => {
        const door = record(rawDoor, `salas[${index}].doors[${doorIndex}]`);
        const side = text(door.side, `porta ${doorIndex} da sala ${id}`, 8) as Side;
        if (!SIDES.has(side)) fail(`lado inválido na porta ${doorIndex} da sala ${id}.`);
        const width = numberValue(door.width, `largura da porta ${doorIndex}`, 1.2, 6);
        const length = side === 'north' || side === 'south' ? rect.w : rect.d;
        const at = numberValue(door.at, `posição da porta ${doorIndex}`, 0, length - width);
        return { side, width, at };
      });
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

    const props = list(source.props ?? [], 'objetos', 500).map((raw, index): PropDef => {
      const item = record(raw, `objetos[${index}]`);
      const kind = text(item.kind, `objetos[${index}].kind`, 32) as PropKind;
      if (!PROP_KINDS.has(kind)) fail(`objeto desconhecido: ${kind}.`);
      const prop = {
        kind,
        x: numberValue(item.x, `objetos[${index}].x`, bounds.x, bounds.x + bounds.w),
        z: numberValue(item.z, `objetos[${index}].z`, bounds.z, bounds.z + bounds.d),
        rot: numberValue(item.rot ?? 0, `objetos[${index}].rot`, -Math.PI * 2, Math.PI * 2),
        level: levelValue(item.level, `objetos[${index}].level`),
      };
      if (!roomContaining(rooms, prop)) fail(`o objeto ${index} está fora de uma sala.`);
      return prop;
    });

    const taskIds = new Set<string>();
    const taskSpots = list(source.taskSpots, 'tarefas', 200).map((raw, index): TaskSpot => {
      const item = record(raw, `tarefas[${index}]`);
      const id = idValue(item.id, `tarefas[${index}].id`);
      if (taskIds.has(id)) fail(`a tarefa ${id} aparece mais de uma vez.`);
      taskIds.add(id);
      const kind = text(item.kind, `tarefas[${index}].kind`, 24) as TaskKind;
      if (!TASK_KINDS.has(kind)) fail(`tipo de tarefa desconhecido: ${kind}.`);
      const spot = {
        id,
        kind,
        room: idValue(item.room, `sala da tarefa ${id}`),
        label: text(item.label, `nome da tarefa ${id}`, 80),
        x: numberValue(item.x, `tarefas[${index}].x`, bounds.x, bounds.x + bounds.w),
        z: numberValue(item.z, `tarefas[${index}].z`, bounds.z, bounds.z + bounds.d),
        level: levelValue(item.level, `tarefas[${index}].level`),
      };
      const room = rooms.find((candidate) => candidate.id === spot.room);
      if (!room || !insideRoom(room, spot)) fail(`a tarefa ${id} não está dentro da sala informada.`);
      return spot;
    });
    if (taskSpots.length < 4) fail('adicione pelo menos quatro pontos de tarefa.');

    const ventIds = new Set<string>();
    const vents = list(source.vents ?? [], 'dutos', 50).map((raw, index): VentDef => {
      const item = record(raw, `dutos[${index}]`);
      const id = idValue(item.id, `dutos[${index}].id`);
      if (ventIds.has(id)) fail(`o duto ${id} aparece mais de uma vez.`);
      ventIds.add(id);
      const vent = {
        id,
        room: idValue(item.room, `sala do duto ${id}`),
        x: numberValue(item.x, `dutos[${index}].x`, bounds.x, bounds.x + bounds.w),
        z: numberValue(item.z, `dutos[${index}].z`, bounds.z, bounds.z + bounds.d),
        links: list(item.links ?? [], `ligações do duto ${id}`, 8).map((link) => idValue(link, `ligação do duto ${id}`)),
        level: levelValue(item.level, `dutos[${index}].level`),
      };
      const room = rooms.find((candidate) => candidate.id === vent.room);
      if (!room || !insideRoom(room, vent)) fail(`o duto ${id} não está dentro da sala informada.`);
      return vent;
    });
    for (const vent of vents) {
      for (const link of vent.links) if (!ventIds.has(link)) fail(`o duto ${vent.id} aponta para ${link}, que não existe.`);
    }

    const stairs = list(source.stairs ?? [], 'escadas', 20).map((raw, index): StairDef => {
      const item = record(raw, `escadas[${index}]`);
      const stair = {
        id: idValue(item.id, `escadas[${index}].id`),
        level: levelValue(item.level, `escadas[${index}].level`),
        x: numberValue(item.x, `escadas[${index}].x`, bounds.x, bounds.x + bounds.w),
        z: numberValue(item.z, `escadas[${index}].z`, bounds.z, bounds.z + bounds.d),
        rot: numberValue(item.rot ?? 0, `escadas[${index}].rot`, -Math.PI * 2, Math.PI * 2),
        targetLevel: levelValue(item.targetLevel, `escadas[${index}].targetLevel`),
        targetX: numberValue(item.targetX, `escadas[${index}].targetX`, bounds.x, bounds.x + bounds.w),
        targetZ: numberValue(item.targetZ, `escadas[${index}].targetZ`, bounds.z, bounds.z + bounds.d),
      };
      if (stair.level === stair.targetLevel) fail(`a escada ${stair.id} precisa ligar andares diferentes.`);
      return stair;
    });
    if (rooms.some((room) => room.level === 1) && !stairs.some((stair) => stair.targetLevel > stair.level)) {
      fail('o segundo andar precisa de pelo menos uma escada de subida.');
    }

    const point = (raw: unknown, label: string) => {
      const item = record(raw, label);
      const result = {
        x: numberValue(item.x, `${label}.x`, bounds.x, bounds.x + bounds.w),
        z: numberValue(item.z, `${label}.z`, bounds.z, bounds.z + bounds.d),
        level: levelValue(item.level, `${label}.level`),
      };
      if (!roomContaining(rooms, result)) fail(`${label} está fora de uma sala.`);
      return result;
    };
    const emergency = point(source.emergency, 'mesa de emergência');
    const spawns = list(source.spawns, 'pontos de entrada', 24).map((raw, index) => point(raw, `entrada ${index + 1}`));
    if (spawns.length < 4) fail('adicione pelo menos quatro pontos de entrada.');
    const meetingSeats = list(source.meetingSeats, 'lugares da reunião', 16).map((raw, index) => {
      const seat = record(raw, `lugar da reunião ${index + 1}`);
      return {
        ...point(seat, `lugar da reunião ${index + 1}`),
        dir: numberValue(seat.dir ?? 0, `direção do lugar ${index + 1}`, -Math.PI * 2, Math.PI * 2),
      };
    });
    if (meetingSeats.length < 4) fail('adicione pelo menos quatro lugares para a reunião.');

    const sourceMeta = source.source && typeof source.source === 'object' ? record(source.source, 'origem') : null;
    const normalizedSource = sourceMeta
      ? {
          label: typeof sourceMeta.label === 'string' ? sourceMeta.label.slice(0, 100) : undefined,
          referenceUrl: typeof sourceMeta.referenceUrl === 'string' && /^https:\/\//.test(sourceMeta.referenceUrl)
            ? sourceMeta.referenceUrl.slice(0, 500)
            : undefined,
          latitude: sourceMeta.latitude === undefined ? undefined : numberValue(sourceMeta.latitude, 'latitude', -90, 90),
          longitude: sourceMeta.longitude === undefined ? undefined : numberValue(sourceMeta.longitude, 'longitude', -180, 180),
          gameUnitsPerMeter: sourceMeta.gameUnitsPerMeter === undefined
            ? undefined
            : numberValue(sourceMeta.gameUnitsPerMeter, 'escala', 0.05, 4),
        }
      : undefined;

    return {
      name,
      bounds,
      rooms,
      walls: buildWalls(rooms),
      obstacles: [...buildObstacles(props), ...buildStairBarriers(stairs)],
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
