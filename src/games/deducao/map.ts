/// O escritório onde a partida acontece. Este arquivo é a única fonte da
/// verdade do mapa: o servidor usa as paredes para colisão e os pontos de
/// tarefa para validar o que o jogador diz que fez, e o navegador baixa o mesmo
/// JSON para desenhar a cena. Duas cópias do mapa viravam duas verdades.
///
/// Eixos: x cresce para leste, z cresce para o sul. Uma unidade é um metro.
///
/// O escritório é um prédio contínuo de dois pavimentos. Salas fechadas se
/// ligam por portas e corredores laterais; as duas escadas ocupam o mesmo volume
/// nos dois andares e têm guarda-corpo onde a laje é recortada.

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface WallBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /// Altura da superfície em metros. Paredes não precisam informar: elas
  /// continuam bloqueando em qualquer altura alcançável pelo jogador.
  height?: number;
  /// Cor de destaque do cômodo dono desta parede. A colisão ignora, mas o
  /// navegador pinta o friso do alto com ela, e é isso que faz cada sala ter
  /// cara própria de longe. Opcional porque parede de teste não tem dono.
  accent?: string;
  /// Chega na altura dos olhos, então além de barrar o corpo também corta a
  /// linha de visão. Mesa e sofá não: dá para ver por cima deles.
  tall?: boolean;
  /// Pavimento ao qual a colisão pertence. Ausente significa térreo para os
  /// testes e mapas antigos.
  level?: number;
  /// No terraço a borda barra o corpo, mas é baixa e não tapa a visão.
  style?: 'parede' | 'guarda-corpo';
}

export type Side = 'north' | 'south' | 'east' | 'west';

export interface Door {
  side: Side;
  /// Distância do canto inicial da parede até onde o vão começa.
  at: number;
  width: number;
}

export type RoomKind =
  | 'sala'
  | 'corredor'
  | 'terraco'
  | 'externa'
  | 'agua'
  | 'campo';
export type FloorFinish =
  | 'carpet'
  | 'patternedCarpet'
  | 'wood'
  | 'parquet'
  | 'server'
  | 'terrazzo'
  | 'vinyl'
  | 'pantry'
  | 'bathroom'
  | 'concrete'
  | 'grass'
  | 'water'
  | 'sport'
  | 'asphalt';

export interface RoomDef {
  id: string;
  name: string;
  rect: Rect;
  /// Cômodo de verdade ou pedaço de circulação. O navegador desenha o piso da
  /// circulação mais baixo e sem tapete, para o corredor não competir com as
  /// salas na leitura de cima.
  kind: RoomKind;
  level?: number;
  /// Cor do piso, no formato que o Three entende direto.
  floor: string;
  /// Material visual usado pelo navegador. A cor acima continua sendo o tom de
  /// segurança caso a textura ainda não tenha carregado.
  finish: FloorFinish;
  /// Cor de destaque da sala. É ela que acende no friso das paredes e diz de
  /// longe em que cômodo o jogador está. O apagão apaga todas.
  light: string;
  doors: Door[];
}

export type PropKind =
  | 'desk'
  | 'chair'
  | 'monitor'
  | 'plant'
  | 'sofa'
  | 'counter'
  | 'meetingTable'
  | 'cafeTable'
  | 'rack'
  | 'locker'
  | 'shelf'
  | 'coffee'
  | 'crate'
  | 'printer'
  | 'whiteboard'
  | 'car'
  | 'sportCar'
  | 'cone'
  | 'sink'
  | 'bathroomVanity'
  | 'toilet'
  | 'vending'
  | 'kitchen'
  | 'gameTable'
  | 'arcade'
  | 'tree'
  | 'streetLamp'
  | 'bench';

export interface PropDef {
  kind: PropKind;
  x: number;
  /// Altura visual para objetos apoiados, como a cafeteira sobre a bancada.
  y?: number;
  z: number;
  /// Rotação em torno do eixo vertical, em radianos.
  rot: number;
  level?: number;
}

export type TaskKind =
  | 'rack'
  | 'arquivo'
  | 'senha'
  | 'cafe'
  | 'cabos'
  | 'impressora'
  | 'estoque';

export interface TaskSpot {
  id: string;
  kind: TaskKind;
  room: string;
  label: string;
  x: number;
  z: number;
  level?: number;
}

export interface VentDef {
  id: string;
  room: string;
  x: number;
  z: number;
  /// Para onde este duto leva. A ligação é sempre nos dois sentidos.
  links: string[];
  level?: number;
}

export interface StairDef {
  id: string;
  level: number;
  x: number;
  z: number;
  rot: number;
  turnX?: number;
  turnZ?: number;
  targetLevel: number;
  targetX: number;
  targetZ: number;
}

export interface StairProgress {
  stair: StairDef;
  /// 0 é o piso de baixo e 1 é o piso de cima.
  progress: number;
}

export interface GameMap {
  name: string;
  bounds: Rect;
  rooms: RoomDef[];
  walls: WallBox[];
  /// A pegada dos móveis no chão. Sai separada das paredes porque nem todo
  /// móvel corta a visão, e porque o navegador desenha parede e móvel de
  /// jeitos diferentes.
  obstacles: WallBox[];
  props: PropDef[];
  taskSpots: TaskSpot[];
  vents: VentDef[];
  stairs: StairDef[];
  emergency: { x: number; y?: number; z: number; level?: number };
  spawns: { x: number; z: number; level?: number }[];
  meetingSeats: { x: number; z: number; level: number; dir: number }[];
  source?: {
    label?: string;
    referenceUrl?: string;
    latitude?: number;
    longitude?: number;
    gameUnitsPerMeter?: number;
  };
}

const WALL = 0.4;
const HALF = WALL / 2;

function segmentsFor(room: RoomDef, side: Side): WallBox[] {
  const { x, z, w, d } = room.rect;
  const horizontal = side === 'north' || side === 'south';
  const length = horizontal ? w : d;
  const doors = room.doors
    .filter((door) => door.side === side)
    .sort((left, right) => left.at - right.at);

  const spans: [number, number][] = [];
  let cursor = 0;
  for (const door of doors) {
    if (door.at > cursor) spans.push([cursor, door.at]);
    cursor = door.at + door.width;
  }
  if (cursor < length) spans.push([cursor, length]);

  return spans.map(([from, to]) => {
    if (side === 'north')
      return { minX: x + from, minZ: z - HALF, maxX: x + to, maxZ: z + HALF };
    if (side === 'south')
      return {
        minX: x + from,
        minZ: z + d - HALF,
        maxX: x + to,
        maxZ: z + d + HALF,
      };
    if (side === 'west')
      return { minX: x - HALF, minZ: z + from, maxX: x + HALF, maxZ: z + to };
    return {
      minX: x + w - HALF,
      minZ: z + from,
      maxX: x + w + HALF,
      maxZ: z + to,
    };
  });
}

export function buildWalls(rooms: RoomDef[]): WallBox[] {
  const raw = rooms.flatMap((room) => {
    if (
      room.kind === 'externa' ||
      room.kind === 'agua' ||
      room.kind === 'campo'
    )
      return [];
    return (['north', 'south', 'east', 'west'] as Side[]).flatMap((side) =>
      segmentsFor(room, side).map((box) => ({
        ...box,
        accent: room.light,
        level: room.level ?? 0,
        style:
          room.kind === 'terraco'
            ? ('guarda-corpo' as const)
            : ('parede' as const),
      })),
    );
  });

  // No editor basta abrir a porta por um dos lados da divisória. A sala vizinha
  // ainda descreve a parede inteira, então todas as cópias no mesmo eixo são
  // recortadas antes da união. Isso também impede colisão invisível na porta.
  const openings = rooms.flatMap((room) =>
    room.doors.map((door) => {
      const horizontal = door.side === 'north' || door.side === 'south';
      return {
        level: room.level ?? 0,
        horizontal,
        axis: horizontal
          ? room.rect.z + (door.side === 'south' ? room.rect.d : 0)
          : room.rect.x + (door.side === 'east' ? room.rect.w : 0),
        from: (horizontal ? room.rect.x : room.rect.z) + door.at,
        to: (horizontal ? room.rect.x : room.rect.z) + door.at + door.width,
      };
    }),
  );
  const carved = raw.flatMap((box) => {
    const horizontal = box.maxX - box.minX >= box.maxZ - box.minZ;
    const axis = horizontal
      ? (box.minZ + box.maxZ) / 2
      : (box.minX + box.maxX) / 2;
    let spans: Array<[number, number]> = [
      [horizontal ? box.minX : box.minZ, horizontal ? box.maxX : box.maxZ],
    ];
    for (const opening of openings) {
      if (
        opening.level !== (box.level ?? 0) ||
        opening.horizontal !== horizontal ||
        Math.abs(opening.axis - axis) > 0.001
      )
        continue;
      spans = spans.flatMap(([from, to]) => {
        if (opening.to <= from || opening.from >= to) return [[from, to]];
        return [
          [from, Math.max(from, opening.from)],
          [Math.min(to, opening.to), to],
        ].filter(([left, right]) => right - left > 0.001) as Array<
          [number, number]
        >;
      });
    }
    return spans.map(([from, to]) =>
      horizontal
        ? { ...box, minX: from, maxX: to }
        : { ...box, minZ: from, maxZ: to },
    );
  });

  // Salas vizinhas descrevem a mesma divisória pelos dois lados. Unir os
  // trechos coplanares impede duas malhas de brigarem pelo mesmo pixel.
  const groups = new Map<string, WallBox[]>();
  for (const box of carved) {
    const horizontal = box.maxX - box.minX >= box.maxZ - box.minZ;
    const axis = horizontal
      ? (box.minZ + box.maxZ) / 2
      : (box.minX + box.maxX) / 2;
    const key = `${box.level ?? 0}:${box.style ?? 'parede'}:${horizontal ? 'h' : 'v'}:${axis.toFixed(3)}`;
    const group = groups.get(key) ?? [];
    group.push(box);
    groups.set(key, group);
  }

  const merged: WallBox[] = [];
  for (const group of groups.values()) {
    const horizontal =
      group[0].maxX - group[0].minX >= group[0].maxZ - group[0].minZ;
    const sorted = [...group].sort((a, b) =>
      horizontal ? a.minX - b.minX : a.minZ - b.minZ,
    );
    let current = { ...sorted[0] };
    for (const next of sorted.slice(1)) {
      const touching = horizontal
        ? next.minX <= current.maxX + 0.001
        : next.minZ <= current.maxZ + 0.001;
      if (touching) {
        if (horizontal) current.maxX = Math.max(current.maxX, next.maxX);
        else current.maxZ = Math.max(current.maxZ, next.maxZ);
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
  }

  return merged;
}

/// Água é cenário atravessável visualmente, mas não chão jogável. A borda não
/// ganha parede: a colisão ocupa somente a lâmina da piscina/lago.
export function buildTerrainObstacles(rooms: RoomDef[]): WallBox[] {
  return rooms
    .filter((room) => room.kind === 'agua')
    .map((room) => ({
      minX: room.rect.x + 0.15,
      minZ: room.rect.z + 0.15,
      maxX: room.rect.x + room.rect.w - 0.15,
      maxZ: room.rect.z + room.rect.d - 0.15,
      level: room.level ?? 0,
      tall: false,
    }));
}

interface Link {
  a: string;
  b: string;
}

/// Duas salas encostadas ganham uma porta central de verdade. Abrir a parede na
/// largura inteira fazia todos os cômodos parecerem baias sem divisória.
function openLinks(rooms: RoomDef[], links: Link[]) {
  const byId = new Map(rooms.map((room) => [room.id, room]));

  for (const link of links) {
    const a = byId.get(link.a);
    const b = byId.get(link.b);
    if (!a || !b)
      throw new Error(`Ligação com sala inexistente: ${link.a} + ${link.b}`);

    const aSouth = a.rect.z + a.rect.d === b.rect.z;
    const aNorth = b.rect.z + b.rect.d === a.rect.z;
    const aEast = a.rect.x + a.rect.w === b.rect.x;
    const aWest = b.rect.x + b.rect.w === a.rect.x;

    if (aSouth || aNorth) {
      const from = Math.max(a.rect.x, b.rect.x);
      const to = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w);
      if (to <= from)
        throw new Error(`Salas ${a.id} e ${b.id} se tocam sem sobrepor`);
      const width = Math.min(3.2, to - from);
      const opening = from + (to - from - width) / 2;
      a.doors.push({
        side: aSouth ? 'south' : 'north',
        at: opening - a.rect.x,
        width,
      });
      b.doors.push({
        side: aSouth ? 'north' : 'south',
        at: opening - b.rect.x,
        width,
      });
      continue;
    }

    if (aEast || aWest) {
      const from = Math.max(a.rect.z, b.rect.z);
      const to = Math.min(a.rect.z + a.rect.d, b.rect.z + b.rect.d);
      if (to <= from)
        throw new Error(`Salas ${a.id} e ${b.id} se tocam sem sobrepor`);
      const width = Math.min(3.2, to - from);
      const opening = from + (to - from - width) / 2;
      a.doors.push({
        side: aEast ? 'east' : 'west',
        at: opening - a.rect.z,
        width,
      });
      b.doors.push({
        side: aEast ? 'west' : 'east',
        at: opening - b.rect.z,
        width,
      });
      continue;
    }

    throw new Error(`Salas ${a.id} e ${b.id} não se encostam`);
  }
}

/// Dois pavimentos dentro do mesmo volume. Corredores laterais separam as salas
/// do átrio, dão quinas para perseguição e evitam o aspecto de tabuleiro aberto.
const OFFICE_LAYOUT_ORIGIN = 3;
const OFFICE_LAYOUT_SCALE = 0.84;
const ORIGINAL_BOUNDS = { w: 74, d: 58 } as const;

function compactAxis(value: number) {
  return (
    OFFICE_LAYOUT_ORIGIN + (value - OFFICE_LAYOUT_ORIGIN) * OFFICE_LAYOUT_SCALE
  );
}

function compactPlacement<T extends { x: number; z: number }>(item: T): T {
  return {
    ...item,
    x: compactAxis(item.x),
    z: compactAxis(item.z),
  };
}

function compactRoom(room: RoomDef): RoomDef {
  return {
    ...room,
    rect: {
      x: compactAxis(room.rect.x),
      z: compactAxis(room.rect.z),
      w: room.rect.w * OFFICE_LAYOUT_SCALE,
      d: room.rect.d * OFFICE_LAYOUT_SCALE,
    },
    doors: room.doors.map((door) => ({
      ...door,
      at: door.at * OFFICE_LAYOUT_SCALE,
      width: door.width * OFFICE_LAYOUT_SCALE,
    })),
  };
}

function compactStair(stair: StairDef): StairDef {
  return {
    ...compactPlacement(stair),
    ...(stair.turnX !== undefined && stair.turnZ !== undefined
      ? {
          turnX: compactAxis(stair.turnX),
          turnZ: compactAxis(stair.turnZ),
        }
      : {}),
    targetX: compactAxis(stair.targetX),
    targetZ: compactAxis(stair.targetZ),
  };
}

const ROOMS: RoomDef[] = [
  {
    id: 'servidores',
    name: 'Sala dos servidores',
    rect: { x: 3, z: 3, w: 20, d: 14 },
    kind: 'sala',
    floor: '#4c718a',
    finish: 'server',
    light: '#38bdf8',
    doors: [],
  },
  {
    id: 'openspace',
    name: 'Open space',
    rect: { x: 23, z: 3, w: 28, d: 14 },
    kind: 'sala',
    floor: '#6e8299',
    finish: 'carpet',
    light: '#38bdf8',
    doors: [],
  },
  {
    id: 'reuniao',
    name: 'Sala de reunião',
    rect: { x: 51, z: 3, w: 20, d: 14 },
    kind: 'sala',
    floor: '#a97850',
    finish: 'wood',
    light: '#f6a35c',
    doors: [],
  },
  {
    id: 'recepcao',
    name: 'Recepção',
    rect: { x: 3, z: 17, w: 16, d: 18 },
    kind: 'sala',
    floor: '#8b98a8',
    finish: 'terrazzo',
    light: '#7aa2f7',
    doors: [],
  },
  {
    id: 'corredor-oeste',
    name: 'Corredor oeste',
    rect: { x: 19, z: 17, w: 8, d: 24 },
    kind: 'corredor',
    floor: '#8794a5',
    finish: 'vinyl',
    light: '#60a5fa',
    doors: [],
  },
  {
    id: 'hall-central',
    name: 'Átrio central',
    rect: { x: 27, z: 17, w: 20, d: 24 },
    kind: 'sala',
    floor: '#677b95',
    finish: 'patternedCarpet',
    light: '#93c5fd',
    doors: [],
  },
  {
    id: 'corredor-leste',
    name: 'Corredor leste',
    rect: { x: 47, z: 17, w: 8, d: 24 },
    kind: 'corredor',
    floor: '#8794a5',
    finish: 'vinyl',
    light: '#60a5fa',
    doors: [],
  },
  {
    id: 'copa',
    name: 'Copa',
    rect: { x: 55, z: 17, w: 16, d: 18 },
    kind: 'sala',
    floor: '#668c79',
    finish: 'pantry',
    light: '#4ade80',
    doors: [],
  },
  {
    id: 'garagem',
    name: 'Garagem',
    rect: { x: 3, z: 35, w: 16, d: 20 },
    kind: 'sala',
    floor: '#777f89',
    finish: 'concrete',
    light: '#fb923c',
    doors: [],
  },
  {
    id: 'banheiro',
    name: 'Banheiro',
    rect: { x: 55, z: 35, w: 16, d: 10 },
    kind: 'sala',
    floor: '#778493',
    finish: 'bathroom',
    light: '#67e8f9',
    doors: [],
  },
  {
    id: 'deposito',
    name: 'Depósito',
    rect: { x: 55, z: 45, w: 16, d: 10 },
    kind: 'sala',
    floor: '#837565',
    finish: 'concrete',
    light: '#f59e0b',
    doors: [],
  },

  // Segundo andar
  {
    id: 'arquivo',
    name: 'Arquivo executivo',
    rect: { x: 3, z: 3, w: 20, d: 14 },
    kind: 'sala',
    level: 1,
    floor: '#766a8b',
    finish: 'carpet',
    light: '#c084fc',
    doors: [],
  },
  {
    id: 'operacoes',
    name: 'Central de operações',
    rect: { x: 23, z: 3, w: 28, d: 14 },
    kind: 'sala',
    level: 1,
    floor: '#4f748b',
    finish: 'server',
    light: '#22d3ee',
    doors: [],
  },
  {
    id: 'chefe',
    name: 'Sala do chefe',
    rect: { x: 51, z: 3, w: 20, d: 14 },
    kind: 'sala',
    level: 1,
    floor: '#9a704e',
    finish: 'parquet',
    light: '#f59e0b',
    doors: [],
  },
  {
    id: 'lounge',
    name: 'Lounge',
    rect: { x: 3, z: 17, w: 16, d: 18 },
    kind: 'sala',
    level: 1,
    floor: '#5e8378',
    finish: 'patternedCarpet',
    light: '#34d399',
    doors: [],
  },
  {
    id: 'corredor-superior-oeste',
    name: 'Corredor superior oeste',
    rect: { x: 19, z: 17, w: 8, d: 24 },
    kind: 'corredor',
    level: 1,
    floor: '#75849a',
    finish: 'vinyl',
    light: '#818cf8',
    doors: [],
  },
  {
    id: 'hall-superior',
    name: 'Mezanino',
    rect: { x: 27, z: 17, w: 20, d: 24 },
    kind: 'sala',
    level: 1,
    floor: '#687996',
    finish: 'patternedCarpet',
    light: '#818cf8',
    doors: [],
  },
  {
    id: 'corredor-superior-leste',
    name: 'Corredor superior leste',
    rect: { x: 47, z: 17, w: 8, d: 24 },
    kind: 'corredor',
    level: 1,
    floor: '#75849a',
    finish: 'vinyl',
    light: '#818cf8',
    doors: [],
  },
  {
    id: 'terraco',
    name: 'Terraço',
    rect: { x: 55, z: 17, w: 16, d: 38 },
    kind: 'terraco',
    level: 1,
    floor: '#7f898c',
    finish: 'concrete',
    light: '#86efac',
    doors: [],
  },
  {
    id: 'conselho',
    name: 'Sala do conselho',
    rect: { x: 3, z: 35, w: 16, d: 20 },
    kind: 'sala',
    level: 1,
    floor: '#8e7058',
    finish: 'parquet',
    light: '#f0abfc',
    doors: [],
  },
];

const LINKS: Link[] = [
  { a: 'servidores', b: 'corredor-oeste' },
  { a: 'openspace', b: 'hall-central' },
  { a: 'reuniao', b: 'corredor-leste' },
  { a: 'recepcao', b: 'corredor-oeste' },
  { a: 'corredor-oeste', b: 'hall-central' },
  { a: 'hall-central', b: 'corredor-leste' },
  { a: 'copa', b: 'corredor-leste' },
  { a: 'garagem', b: 'corredor-oeste' },
  { a: 'banheiro', b: 'corredor-leste' },
  { a: 'banheiro', b: 'deposito' },
  { a: 'arquivo', b: 'corredor-superior-oeste' },
  { a: 'operacoes', b: 'hall-superior' },
  { a: 'chefe', b: 'corredor-superior-leste' },
  { a: 'lounge', b: 'corredor-superior-oeste' },
  { a: 'corredor-superior-oeste', b: 'hall-superior' },
  { a: 'hall-superior', b: 'corredor-superior-leste' },
  { a: 'terraco', b: 'corredor-superior-leste' },
  { a: 'conselho', b: 'corredor-superior-oeste' },
];

openLinks(ROOMS, LINKS);

function deskCluster(x: number, z: number, rot: number): PropDef[] {
  const reversed = Math.abs(Math.cos(rot) + 1) < 0.01;
  const screenZ = z + (reversed ? 0.34 : -0.34);
  const chairZ = z + (reversed ? -1.28 : 1.28);
  return [
    { kind: 'desk', x, z, rot },
    { kind: 'monitor', x: x - 0.34, z: screenZ, rot },
    { kind: 'monitor', x: x + 0.34, z: screenZ, rot },
    { kind: 'chair', x, z: chairZ, rot },
  ];
}

function buildProps(): PropDef[] {
  const props: PropDef[] = [
    // Térreo: recepção e átrio
    { kind: 'counter', x: 10.5, z: 21, rot: 0 },
    { kind: 'monitor', x: 10.5, z: 20.6, rot: 0 },
    { kind: 'sofa', x: 7, z: 30.5, rot: 0 },
    { kind: 'plant', x: 4.5, z: 19, rot: 0 },
    { kind: 'plant', x: 17.2, z: 33, rot: 0 },
    { kind: 'sofa', x: 30.5, z: 20.2, rot: 0 },
    { kind: 'plant', x: 28.5, z: 19, rot: 0 },
    { kind: 'plant', x: 43, z: 32, rot: 0 },
    { kind: 'printer', x: 49, z: 15, rot: Math.PI },
    { kind: 'sofa', x: 43.5, z: 20.2, rot: Math.PI },
    { kind: 'sofa', x: 30.5, z: 37.8, rot: 0 },
    { kind: 'cafeTable', x: 34, z: 20.5, rot: 0 },
    { kind: 'cafeTable', x: 40, z: 20.5, rot: 0 },
    { kind: 'chair', x: 38.5, z: 20.5, rot: Math.PI / 2 },
    { kind: 'chair', x: 41.5, z: 20.5, rot: -Math.PI / 2 },
    { kind: 'sofa', x: 32.5, z: 29, rot: -Math.PI / 2 },
    { kind: 'sofa', x: 41.5, z: 29, rot: Math.PI / 2 },
    { kind: 'cafeTable', x: 37, z: 29, rot: 0 },
    { kind: 'cafeTable', x: 37, z: 36, rot: 0 },

    // Térreo: sala dos servidores
    { kind: 'rack', x: 6, z: 6, rot: 0 },
    { kind: 'rack', x: 9, z: 6, rot: 0 },
    { kind: 'rack', x: 12, z: 6, rot: 0 },
    { kind: 'rack', x: 15, z: 6, rot: 0 },
    { kind: 'rack', x: 18, z: 6, rot: 0 },
    { kind: 'rack', x: 8, z: 13, rot: Math.PI },
    { kind: 'rack', x: 12, z: 13, rot: Math.PI },
    { kind: 'rack', x: 16, z: 13, rot: Math.PI },

    // Térreo: reunião e copa
    { kind: 'meetingTable', x: 61, z: 9.5, rot: 0 },
    ...[58, 59.5, 61, 62.5, 64].flatMap((x) => [
      { kind: 'chair' as const, x, z: 7.15, rot: 0 },
      { kind: 'chair' as const, x, z: 11.85, rot: Math.PI },
    ]),
    { kind: 'chair', x: 56.3, z: 9.5, rot: Math.PI / 2 },
    { kind: 'chair', x: 65.7, z: 9.5, rot: -Math.PI / 2 },
    { kind: 'whiteboard', x: 61, z: 4.1, rot: 0 },
    { kind: 'kitchen', x: 70.1, z: 21, rot: -Math.PI / 2 },
    { kind: 'coffee', x: 69.72, y: 0.91, z: 19.6, rot: -Math.PI / 2 },
    { kind: 'vending', x: 69.7, z: 25.1, rot: -Math.PI / 2 },
    { kind: 'cafeTable', x: 59.5, z: 21, rot: 0 },
    { kind: 'chair', x: 57.9, z: 21, rot: Math.PI / 2 },
    { kind: 'chair', x: 61.1, z: 21, rot: -Math.PI / 2 },
    { kind: 'cafeTable', x: 63.5, z: 31, rot: 0 },
    { kind: 'chair', x: 61.9, z: 31, rot: Math.PI / 2 },
    { kind: 'chair', x: 65.1, z: 31, rot: -Math.PI / 2 },
    { kind: 'plant', x: 69, z: 33, rot: 0 },
    { kind: 'cafeTable', x: 59.5, z: 29.5, rot: 0 },
    { kind: 'chair', x: 57.9, z: 29.5, rot: Math.PI / 2 },
    { kind: 'chair', x: 61.1, z: 29.5, rot: -Math.PI / 2 },

    // Térreo: garagem e depósito
    { kind: 'car', x: 8, z: 45.5, rot: 0 },
    { kind: 'sportCar', x: 14, z: 45.5, rot: 0 },
    { kind: 'cone', x: 10.8, z: 52.5, rot: 0 },
    { kind: 'cone', x: 12, z: 51.5, rot: 0 },
    { kind: 'crate', x: 5, z: 53, rot: 0.2 },
    { kind: 'bathroomVanity', x: 69.65, z: 40.4, rot: -Math.PI / 2 },
    { kind: 'toilet', x: 58.5, z: 42.6, rot: Math.PI },
    { kind: 'toilet', x: 62.2, z: 42.6, rot: Math.PI },
    { kind: 'plant', x: 68.5, z: 36.5, rot: 0 },
    { kind: 'shelf', x: 58, z: 50, rot: Math.PI / 2 },
    { kind: 'shelf', x: 68, z: 50, rot: -Math.PI / 2 },
    { kind: 'crate', x: 64, z: 51, rot: 0.3 },
    { kind: 'crate', x: 66, z: 52, rot: -0.3 },

    // Segundo andar: arquivo, lounge e mezanino
    { kind: 'locker', x: 5, z: 6, rot: Math.PI / 2, level: 1 },
    { kind: 'locker', x: 5, z: 10, rot: Math.PI / 2, level: 1 },
    { kind: 'locker', x: 21, z: 6, rot: -Math.PI / 2, level: 1 },
    { kind: 'locker', x: 21, z: 10, rot: -Math.PI / 2, level: 1 },
    { kind: 'shelf', x: 12, z: 4.2, rot: Math.PI, level: 1 },
    { kind: 'shelf', x: 12, z: 15, rot: 0, level: 1 },
    { kind: 'sofa', x: 8, z: 24, rot: 0, level: 1 },
    { kind: 'sofa', x: 14, z: 30, rot: Math.PI, level: 1 },
    { kind: 'vending', x: 17, z: 20, rot: -Math.PI / 2, level: 1 },
    { kind: 'gameTable', x: 11, z: 20.8, rot: 0, level: 1 },
    { kind: 'arcade', x: 17.2, z: 28.8, rot: -Math.PI / 2, level: 1 },
    { kind: 'arcade', x: 17.2, z: 31.2, rot: -Math.PI / 2, level: 1 },
    { kind: 'plant', x: 5, z: 33, rot: 0, level: 1 },
    { kind: 'cafeTable', x: 11, z: 27, rot: 0, level: 1 },
    { kind: 'chair', x: 9.4, z: 27, rot: Math.PI / 2, level: 1 },
    { kind: 'chair', x: 12.6, z: 27, rot: -Math.PI / 2, level: 1 },
    { kind: 'sofa', x: 30.5, z: 20.2, rot: 0, level: 1 },
    { kind: 'sofa', x: 43.5, z: 20.2, rot: Math.PI, level: 1 },
    { kind: 'sofa', x: 30.5, z: 37.8, rot: 0, level: 1 },
    { kind: 'plant', x: 28.5, z: 39, rot: 0, level: 1 },
    { kind: 'plant', x: 45.5, z: 19, rot: 0, level: 1 },
    { kind: 'cafeTable', x: 34, z: 20.5, rot: 0, level: 1 },
    { kind: 'cafeTable', x: 40, z: 20.5, rot: 0, level: 1 },
    { kind: 'chair', x: 38.5, z: 20.5, rot: Math.PI / 2, level: 1 },
    { kind: 'chair', x: 41.5, z: 20.5, rot: -Math.PI / 2, level: 1 },
    { kind: 'sofa', x: 32.5, z: 29, rot: -Math.PI / 2, level: 1 },
    { kind: 'sofa', x: 41.5, z: 29, rot: Math.PI / 2, level: 1 },
    { kind: 'cafeTable', x: 37, z: 29, rot: 0, level: 1 },
    { kind: 'cafeTable', x: 37, z: 36, rot: 0, level: 1 },

    // Segundo andar: sala do chefe
    { kind: 'desk', x: 61, z: 8, rot: 0, level: 1 },
    { kind: 'monitor', x: 61, z: 7.65, rot: 0, level: 1 },
    { kind: 'chair', x: 61, z: 9.3, rot: 0, level: 1 },
    { kind: 'sofa', x: 55, z: 13.5, rot: Math.PI / 2, level: 1 },
    { kind: 'cafeTable', x: 67, z: 12.5, rot: Math.PI / 2, level: 1 },
    { kind: 'plant', x: 69, z: 5, rot: 0, level: 1 },
    { kind: 'whiteboard', x: 61, z: 4.1, rot: 0, level: 1 },
    { kind: 'chair', x: 59.3, z: 10.2, rot: 0, level: 1 },
    { kind: 'chair', x: 62.7, z: 10.2, rot: 0, level: 1 },
    { kind: 'shelf', x: 69.1, z: 9.5, rot: -Math.PI / 2, level: 1 },
    { kind: 'sofa', x: 66, z: 14.6, rot: Math.PI, level: 1 },

    // Segundo andar: terraço e conselho
    { kind: 'cafeTable', x: 63, z: 24, rot: Math.PI / 2, level: 1 },
    { kind: 'cafeTable', x: 63, z: 36, rot: Math.PI / 2, level: 1 },
    { kind: 'sofa', x: 66, z: 48, rot: Math.PI, level: 1 },
    { kind: 'plant', x: 57, z: 20, rot: 0, level: 1 },
    { kind: 'plant', x: 69, z: 31, rot: 0, level: 1 },
    { kind: 'plant', x: 57, z: 52, rot: 0, level: 1 },
    { kind: 'meetingTable', x: 11, z: 45, rot: Math.PI / 2, level: 1 },
    ...[42.5, 44.2, 45.8, 47.5].flatMap((z) => [
      { kind: 'chair' as const, x: 8.8, z, rot: -Math.PI / 2, level: 1 },
      { kind: 'chair' as const, x: 13.2, z, rot: Math.PI / 2, level: 1 },
    ]),
    { kind: 'whiteboard', x: 11, z: 53.8, rot: Math.PI, level: 1 },
  ];

  // Estações no térreo e na central de operações do piso superior.
  for (const level of [0, 1]) {
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const x = 27 + column * 6.2;
        const z = 6 + row * 6;
        for (const item of deskCluster(x, z, row ? Math.PI : 0))
          props.push({ ...item, level });
      }
    }
  }
  return props;
}

const TASK_SPOTS: TaskSpot[] = [
  {
    id: 'rack-a',
    kind: 'rack',
    room: 'servidores',
    label: 'Religar o rack principal',
    x: 9,
    z: 7.15,
  },
  {
    id: 'rack-b',
    kind: 'rack',
    room: 'servidores',
    label: 'Trocar o disco do backup',
    x: 16,
    z: 11.85,
  },
  {
    id: 'cabos-a',
    kind: 'cabos',
    room: 'servidores',
    label: 'Refazer o cabeamento',
    x: 12,
    z: 11.7,
  },
  {
    id: 'senha-a',
    kind: 'senha',
    room: 'openspace',
    label: 'Destravar a estação 3',
    x: 34.35,
    z: 7.2,
  },
  {
    id: 'senha-b',
    kind: 'senha',
    room: 'openspace',
    label: 'Reiniciar a estação 7',
    x: 46.75,
    z: 10.7,
  },
  {
    id: 'cafe-a',
    kind: 'cafe',
    room: 'copa',
    label: 'Calibrar a cafeteira',
    x: 68.65,
    z: 19.6,
  },
  {
    id: 'estoque-a',
    kind: 'estoque',
    room: 'copa',
    label: 'Repor a máquina de venda',
    x: 68.25,
    z: 25.1,
  },
  {
    id: 'higiene-banheiro',
    kind: 'estoque',
    room: 'banheiro',
    label: 'Repor itens de higiene',
    x: 68.35,
    z: 40.4,
  },
  {
    id: 'senha-c',
    kind: 'senha',
    room: 'recepcao',
    label: 'Fechar o caixa da recepção',
    x: 10.5,
    z: 22.2,
  },
  {
    id: 'estoque-b',
    kind: 'estoque',
    room: 'deposito',
    label: 'Conferir o inventário',
    x: 64,
    z: 49.5,
  },
  {
    id: 'cabos-c',
    kind: 'cabos',
    room: 'garagem',
    label: 'Recarregar o carro da empresa',
    x: 8,
    z: 42.25,
  },
  {
    id: 'arquivo-a',
    kind: 'arquivo',
    room: 'arquivo',
    label: 'Arquivar os contratos',
    x: 6.15,
    z: 6,
    level: 1,
  },
  {
    id: 'arquivo-b',
    kind: 'arquivo',
    room: 'arquivo',
    label: 'Separar os documentos sigilosos',
    x: 12,
    z: 15.9,
    level: 1,
  },
  {
    id: 'senha-d',
    kind: 'senha',
    room: 'operacoes',
    label: 'Autorizar o painel de operações',
    x: 40.55,
    z: 10.7,
    level: 1,
  },
  {
    id: 'senha-chefe',
    kind: 'senha',
    room: 'chefe',
    label: 'Liberar o terminal do chefe',
    x: 62.8,
    z: 8,
    level: 1,
  },
  {
    id: 'cabos-conselho',
    kind: 'cabos',
    room: 'conselho',
    label: 'Ligar a tela do conselho',
    x: 11,
    z: 52.5,
    level: 1,
  },
];

/// Quanto cada móvel ocupa do chão, e se ele chega alto o bastante para
/// esconder alguém atrás. Este tamanho é a lei: o servidor barra o passo por
/// ele e o navegador desenha a peça em cima dele. Móvel que não aparece aqui é
/// atravessável de propósito (o monitor fica em cima da mesa, o cone se chuta).
const FOOTPRINTS: Partial<
  Record<PropKind, { w: number; d: number; h: number; tall?: boolean }>
> = {
  desk: { w: 1.82, d: 0.9, h: 0.84 },
  chair: { w: 0.72, d: 0.72, h: 1.18 },
  plant: { w: 0.52, d: 0.52, h: 0.38 },
  // O modelo inteiro chega a 79 cm por causa do encosto. Para caminhar e
  // aterrissar, interessa a altura real do assento.
  sofa: { w: 2.2, d: 1.03, h: 0.46 },
  counter: { w: 4.5, d: 1.1, h: 1.13 },
  meetingTable: { w: 6.65, d: 2.5, h: 0.86 },
  cafeTable: { w: 1.35, d: 1.35, h: 0.82 },
  rack: { w: 0.8, d: 1.0, h: 2, tall: true },
  locker: { w: 1.1, d: 0.55, h: 2, tall: true },
  shelf: { w: 2.6, d: 0.6, h: 1.9, tall: true },
  crate: { w: 1.0, d: 1.0, h: 0.94 },
  printer: { w: 0.9, d: 0.7, h: 0.9 },
  whiteboard: { w: 2.7, d: 0.12, h: 2.05 },
  car: { w: 2.0, d: 4.3, h: 1.5, tall: true },
  sportCar: { w: 2.0, d: 4.45, h: 1.65, tall: true },
  sink: { w: 1.7, d: 0.6, h: 0.95 },
  bathroomVanity: { w: 2.8, d: 0.68, h: 0.94 },
  toilet: { w: 0.72, d: 1.08, h: 0.48 },
  vending: { w: 1.1, d: 0.75, h: 2, tall: true },
  kitchen: { w: 4.2, d: 0.72, h: 2.2, tall: true },
  gameTable: { w: 2.25, d: 1.25, h: 0.92 },
  arcade: { w: 0.85, d: 0.72, h: 1.85, tall: true },
  tree: { w: 1.35, d: 1.35, h: 4, tall: true },
  streetLamp: { w: 0.4, d: 0.4, h: 4, tall: true },
  bench: { w: 1.9, d: 0.65, h: 0.95 },
};

/// O móvel girado continua sendo barrado por uma caixa alinhada aos eixos: é a
/// menor caixa reta que cabe o retângulo girado. Girar a colisão junto sairia
/// mais caro em todo quadro de todo jogador para ganhar centímetros.
export function buildObstacles(props: PropDef[]): WallBox[] {
  const boxes: WallBox[] = [];
  for (const prop of props) {
    const size = FOOTPRINTS[prop.kind];
    if (!size) continue;
    const cos = Math.abs(Math.cos(prop.rot));
    const sin = Math.abs(Math.sin(prop.rot));
    const halfW = (size.w * cos + size.d * sin) / 2;
    const halfD = (size.w * sin + size.d * cos) / 2;
    boxes.push({
      minX: prop.x - halfW,
      minZ: prop.z - halfD,
      maxX: prop.x + halfW,
      maxZ: prop.z + halfD,
      height: size.h,
      tall: size.tall,
      level: prop.level ?? 0,
    });
  }
  return boxes;
}

const VENTS: VentDef[] = [
  {
    id: 'vent-servidores',
    room: 'servidores',
    x: 21,
    z: 15,
    links: ['vent-garagem', 'vent-operacoes'],
  },
  {
    id: 'vent-garagem',
    room: 'garagem',
    x: 17,
    z: 53,
    links: ['vent-servidores', 'vent-terraco'],
  },
  {
    id: 'vent-operacoes',
    room: 'operacoes',
    x: 49,
    z: 15,
    level: 1,
    links: ['vent-servidores', 'vent-chefe'],
  },
  {
    id: 'vent-chefe',
    room: 'chefe',
    x: 69,
    z: 15,
    level: 1,
    links: ['vent-operacoes', 'vent-terraco'],
  },
  {
    id: 'vent-terraco',
    room: 'terraco',
    x: 69,
    z: 53,
    level: 1,
    links: ['vent-chefe', 'vent-garagem'],
  },
];

const STAIRS: StairDef[] = [
  {
    id: 'escada-hall',
    level: 0,
    x: 45.15,
    z: 34.2,
    rot: Math.PI,
    turnX: 45.15,
    turnZ: 39.15,
    targetLevel: 1,
    targetX: 40.2,
    targetZ: 39.15,
  },
];

/// Cadeiras da sala de reunião. A direção já aponta para o centro da mesa,
/// então a câmera e o corpo chegam olhando para a discussão.
const BASE_MEETING_SEATS = [
  ...[58, 59.5, 61, 62.5, 64].flatMap((x) => [
    { x, z: 7.15, dir: 0, level: 0 },
    { x, z: 11.85, dir: Math.PI, level: 0 },
  ]),
  { x: 56.3, z: 9.5, dir: Math.PI / 2, level: 0 },
  { x: 65.7, z: 9.5, dir: -Math.PI / 2, level: 0 },
];

export const MEETING_SEATS = BASE_MEETING_SEATS.map(compactPlacement);

function stairPath(stair: StairDef) {
  const points = [{ x: stair.x, z: stair.z }];
  if (stair.turnX !== undefined && stair.turnZ !== undefined) {
    points.push({ x: stair.turnX, z: stair.turnZ });
  }
  points.push({ x: stair.targetX, z: stair.targetZ });
  return points;
}

export function buildStairBarriers(stairs: StairDef[]): WallBox[] {
  const barriers: WallBox[] = [];
  for (const stair of stairs.filter((item) => item.targetLevel > item.level)) {
    const points = stairPath(stair);
    const side = 1.48;
    const rail = 0.12;
    const end = 0.14;
    const firstDirection = {
      x: points[1].x - points[0].x,
      z: points[1].z - points[0].z,
    };
    const secondDirection =
      points.length === 3
        ? {
            x: points[2].x - points[1].x,
            z: points[2].z - points[1].z,
          }
        : null;
    const insideSign = secondDirection
      ? Math.sign(
          firstDirection.x * secondDirection.z -
            firstDirection.z * secondDirection.x,
        )
      : 0;

    for (const level of [stair.level, stair.targetLevel]) {
      for (let index = 0; index < points.length - 1; index += 1) {
        const from = points[index];
        const to = points[index + 1];
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const length = Math.hypot(dx, dz);
        const unitX = dx / length;
        const unitZ = dz / length;
        const sideX = -unitZ;
        const sideZ = unitX;

        for (const sign of [-1, 1]) {
          const innerRail = points.length === 3 && sign === insideSign;
          const startInset = innerRail && index === 1 ? side + rail : 0;
          const endInset = innerRail && index === 0 ? side + rail : 0;
          const startX = from.x + unitX * startInset + sideX * side * sign;
          const startZ = from.z + unitZ * startInset + sideZ * side * sign;
          const endX = to.x - unitX * endInset + sideX * side * sign;
          const endZ = to.z - unitZ * endInset + sideZ * side * sign;

          barriers.push({
            minX: Math.min(startX, endX) - rail,
            minZ: Math.min(startZ, endZ) - rail,
            maxX: Math.max(startX, endX) + rail,
            maxZ: Math.max(startZ, endZ) + rail,
            level,
          });
        }
      }
    }

    const endBarrier = (
      point: { x: number; z: number },
      neighbor: { x: number; z: number },
      level: number,
    ): WallBox =>
      Math.abs(point.x - neighbor.x) >= Math.abs(point.z - neighbor.z)
        ? {
            minX: point.x - end,
            maxX: point.x + end,
            minZ: point.z - side,
            maxZ: point.z + side,
            level,
          }
        : {
            minX: point.x - side,
            maxX: point.x + side,
            minZ: point.z - end,
            maxZ: point.z + end,
            level,
          };

    // Embaixo fecha o volume sob o desembarque. Em cima, a mesma proteção
    // fecha a borda do vão oposta ao início da descida.
    barriers.push(
      endBarrier(
        points[points.length - 1],
        points[points.length - 2],
        stair.level,
      ),
      endBarrier(points[0], points[1], stair.targetLevel),
    );
  }
  return barriers;
}

const ROOMS_BUILT = ROOMS.map(compactRoom);
const PROPS_BUILT = buildProps().map(compactPlacement);
const TASK_SPOTS_BUILT = TASK_SPOTS.map(compactPlacement);
const VENTS_BUILT = VENTS.map(compactPlacement);
const STAIRS_BUILT = STAIRS.map(compactStair);
const WALLS_BUILT = buildWalls(ROOMS_BUILT);
const OBSTACLES_BUILT = [
  ...buildObstacles(PROPS_BUILT),
  ...buildStairBarriers(STAIRS_BUILT),
];

export const OFFICE_MAP: GameMap = {
  name: 'Escritório Timbas',
  bounds: {
    x: 0,
    z: 0,
    w:
      OFFICE_LAYOUT_ORIGIN * 2 +
      (ORIGINAL_BOUNDS.w - OFFICE_LAYOUT_ORIGIN * 2) * OFFICE_LAYOUT_SCALE,
    d:
      OFFICE_LAYOUT_ORIGIN * 2 +
      (ORIGINAL_BOUNDS.d - OFFICE_LAYOUT_ORIGIN * 2) * OFFICE_LAYOUT_SCALE,
  },
  rooms: ROOMS_BUILT,
  walls: WALLS_BUILT,
  obstacles: OBSTACLES_BUILT,
  props: PROPS_BUILT,
  taskSpots: TASK_SPOTS_BUILT,
  vents: VENTS_BUILT,
  stairs: STAIRS_BUILT,
  emergency: compactPlacement({ x: 61, y: 0.86, z: 10.2, level: 0 }),
  spawns: [
    { x: 34, z: 26, level: 0 },
    { x: 37, z: 26, level: 0 },
    { x: 40, z: 26, level: 0 },
    { x: 34, z: 29, level: 0 },
    { x: 40, z: 29, level: 0 },
    { x: 34, z: 32, level: 0 },
    { x: 37, z: 32, level: 0 },
    { x: 40, z: 32, level: 0 },
    { x: 31, z: 26, level: 0 },
    { x: 43, z: 26, level: 0 },
    { x: 31, z: 32, level: 0 },
    { x: 28, z: 32, level: 0 },
  ].map(compactPlacement),
  meetingSeats: MEETING_SEATS,
};

/// Encontra a posição contínua dentro de uma escada. Só a definição que sobe é
/// usada para que a mesma coordenada sempre produza a mesma altura, independentemente
/// do sentido em que a pessoa está andando.
export function stairProgressAt(
  x: number,
  z: number,
  map: GameMap = OFFICE_MAP,
): StairProgress | null {
  let closest: (StairProgress & { distance: number }) | null = null;

  for (const stair of map.stairs.filter(
    (candidate) => candidate.targetLevel > candidate.level,
  )) {
    const points = stairPath(stair);
    const lengths = points.slice(0, -1).map((point, index) =>
      Math.hypot(
        points[index + 1].x - point.x,
        points[index + 1].z - point.z,
      ),
    );
    const totalLength = lengths.reduce((sum, length) => sum + length, 0);
    let traversed = 0;

    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index];
      const to = points[index + 1];
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const length = lengths[index];
      const rawSegmentProgress =
        ((x - from.x) * dx + (z - from.z) * dz) / (length * length);
      if (rawSegmentProgress < -0.08 || rawSegmentProgress > 1.08) {
        traversed += length;
        continue;
      }

      const segmentProgress = Math.min(1, Math.max(0, rawSegmentProgress));
      const projectedX = from.x + dx * segmentProgress;
      const projectedZ = from.z + dz * segmentProgress;
      const perpendicularDistance = Math.hypot(x - projectedX, z - projectedZ);
      if (perpendicularDistance <= 1.16) {
        const progress =
          (traversed + length * segmentProgress) / totalLength;
        if (!closest || perpendicularDistance < closest.distance) {
          closest = { stair, progress, distance: perpendicularDistance };
        }
      }
      traversed += length;
    }
  }

  return closest ? { stair: closest.stair, progress: closest.progress } : null;
}

/// Tudo em que se esbarra: parede e móvel. Somado uma vez só, porque a conta
/// roda para cada jogador em cada quadro.
export const COLLIDERS: WallBox[] = [...WALLS_BUILT, ...OBSTACLES_BUILT];

/// O que tapa a vista: parede e móvel alto. A mesa fica de fora porque quem
/// está atrás dela continua à vista.
export const SIGHT_BLOCKERS: WallBox[] = [
  ...WALLS_BUILT,
  ...OBSTACLES_BUILT.filter((box) => box.tall),
];

export function collidersFor(
  level: number,
  map: GameMap = OFFICE_MAP,
  feetHeight = 0,
): WallBox[] {
  return [
    ...map.walls.filter((box) => (box.level ?? 0) === level),
    ...map.obstacles.filter(
      (box) =>
        (box.level ?? 0) === level &&
        (box.height === undefined || box.height > feetHeight + 0.06),
    ),
  ];
}

export function surfaceHeightAt(
  x: number,
  z: number,
  level: number,
  map: GameMap = OFFICE_MAP,
  maxHeight = 1.2,
): number {
  return map.obstacles.reduce((height, box) => {
    if (
      (box.level ?? 0) !== level ||
      box.height === undefined ||
      box.height > maxHeight ||
      x < box.minX ||
      x > box.maxX ||
      z < box.minZ ||
      z > box.maxZ
    ) {
      return height;
    }
    return Math.max(height, box.height);
  }, 0);
}

export function sightBlockersFor(
  level: number,
  map: GameMap = OFFICE_MAP,
): WallBox[] {
  return [...map.walls, ...map.obstacles.filter((box) => box.tall)].filter(
    (box) => (box.level ?? 0) === level && box.style !== 'guarda-corpo',
  );
}

export function roomAt(x: number, z: number, level = 0): RoomDef | null {
  return (
    ROOMS_BUILT.find(
      (room) =>
        (room.level ?? 0) === level &&
        x >= room.rect.x &&
        x <= room.rect.x + room.rect.w &&
        z >= room.rect.z &&
        z <= room.rect.z + room.rect.d,
    ) ?? null
  );
}

export function taskSpotById(
  id: string,
  map: GameMap = OFFICE_MAP,
): TaskSpot | undefined {
  return map.taskSpots.find((spot) => spot.id === id);
}

export function ventById(
  id: string,
  map: GameMap = OFFICE_MAP,
): VentDef | undefined {
  return map.vents.find((vent) => vent.id === id);
}
