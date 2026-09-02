/// O escritório onde a partida acontece. Este arquivo é a única fonte da
/// verdade do mapa: o servidor usa as paredes para colisão e os pontos de
/// tarefa para validar o que o jogador diz que fez, e o navegador baixa o mesmo
/// JSON para desenhar a cena. Duas cópias do mapa viravam duas verdades.
///
/// Eixos: x cresce para leste, z cresce para o sul. Uma unidade é um metro.

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
}

export type Side = 'north' | 'south' | 'east' | 'west';

export interface Door {
  side: Side;
  /// Distância do canto inicial da parede até onde o vão começa.
  at: number;
  width: number;
}

export interface RoomDef {
  id: string;
  name: string;
  rect: Rect;
  /// Cor do piso, no formato que o Three entende direto.
  floor: string;
  /// Tom da luz de teto da sala. O apagão desliga todas.
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
  | 'rack'
  | 'locker'
  | 'shelf'
  | 'coffee'
  | 'crate'
  | 'printer'
  | 'whiteboard'
  | 'car'
  | 'cone'
  | 'sink'
  | 'vending';

export interface PropDef {
  kind: PropKind;
  x: number;
  z: number;
  /// Rotação em torno do eixo vertical, em radianos.
  rot: number;
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
}

export interface VentDef {
  id: string;
  room: string;
  x: number;
  z: number;
  /// Para onde este duto leva. A ligação é sempre nos dois sentidos.
  links: string[];
}

export interface GameMap {
  name: string;
  bounds: Rect;
  rooms: RoomDef[];
  walls: WallBox[];
  props: PropDef[];
  taskSpots: TaskSpot[];
  vents: VentDef[];
  emergency: { x: number; z: number };
  spawns: { x: number; z: number }[];
}

const WALL = 0.4;
const HALF = WALL / 2;

/// As salas são retângulos encostados uns nos outros, então a parede entre duas
/// delas é gerada duas vezes. Sem a chave, o navegador desenharia dois planos no
/// mesmo lugar e eles brigariam por pixel.
function wallKey(box: WallBox): string {
  return [box.minX, box.minZ, box.maxX, box.maxZ].map((n) => n.toFixed(2)).join(':');
}

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
    if (side === 'north') return { minX: x + from, minZ: z - HALF, maxX: x + to, maxZ: z + HALF };
    if (side === 'south') return { minX: x + from, minZ: z + d - HALF, maxX: x + to, maxZ: z + d + HALF };
    if (side === 'west') return { minX: x - HALF, minZ: z + from, maxX: x + HALF, maxZ: z + to };
    return { minX: x + w - HALF, minZ: z + from, maxX: x + w + HALF, maxZ: z + to };
  });
}

function buildWalls(rooms: RoomDef[]): WallBox[] {
  const seen = new Map<string, WallBox>();
  for (const room of rooms) {
    for (const side of ['north', 'south', 'east', 'west'] as Side[]) {
      for (const box of segmentsFor(room, side)) {
        const key = wallKey(box);
        if (!seen.has(key)) seen.set(key, box);
      }
    }
  }
  return [...seen.values()];
}

/// Um vão aberto por uma sala tem que existir na vizinha também, senão a porta
/// de um lado bate na parede do outro. Por isso cada porta aparece nas duas.
const ROOMS: RoomDef[] = [
  {
    id: 'recepcao',
    name: 'Recepção',
    rect: { x: 0, z: 0, w: 16, d: 20 },
    floor: '#3a3f52',
    light: '#ffe6c4',
    doors: [
      { side: 'south', at: 5, width: 3.6 },
      { side: 'east', at: 12, width: 4 },
    ],
  },
  {
    id: 'openspace',
    name: 'Open space',
    rect: { x: 16, z: 0, w: 24, d: 20 },
    floor: '#2f3648',
    light: '#dbe8ff',
    doors: [
      { side: 'west', at: 12, width: 4 },
      { side: 'south', at: 6, width: 3.6 },
      { side: 'south', at: 16, width: 3.6 },
    ],
  },
  {
    id: 'reuniao',
    name: 'Sala de reunião',
    rect: { x: 40, z: 0, w: 12, d: 20 },
    floor: '#4a3d33',
    light: '#ffdca8',
    doors: [{ side: 'south', at: 4.2, width: 3.6 }],
  },
  {
    id: 'copa',
    name: 'Copa',
    rect: { x: 52, z: 0, w: 12, d: 20 },
    floor: '#3c4a44',
    light: '#d8ffe8',
    doors: [{ side: 'south', at: 4.2, width: 3.6 }],
  },
  {
    id: 'corredor',
    name: 'Corredor',
    rect: { x: 0, z: 20, w: 64, d: 6 },
    floor: '#33374a',
    light: '#cfd8ff',
    doors: [
      { side: 'north', at: 5, width: 3.6 },
      { side: 'north', at: 22, width: 3.6 },
      { side: 'north', at: 32, width: 3.6 },
      { side: 'north', at: 44.2, width: 3.6 },
      { side: 'north', at: 56.2, width: 3.6 },
      { side: 'south', at: 5, width: 3.6 },
      { side: 'south', at: 19, width: 3.6 },
      { side: 'south', at: 31.5, width: 3.6 },
      { side: 'south', at: 43, width: 3.6 },
      { side: 'south', at: 56, width: 3.6 },
    ],
  },
  {
    id: 'arquivo',
    name: 'Arquivo',
    rect: { x: 0, z: 26, w: 14, d: 18 },
    floor: '#443a4d',
    light: '#e6d4ff',
    doors: [{ side: 'north', at: 5, width: 3.6 }],
  },
  {
    id: 'servidores',
    name: 'Sala dos servidores',
    rect: { x: 14, z: 26, w: 14, d: 18 },
    floor: '#28323f',
    light: '#bfe4ff',
    doors: [{ side: 'north', at: 5, width: 3.6 }],
  },
  {
    id: 'banheiros',
    name: 'Banheiros',
    rect: { x: 28, z: 26, w: 10, d: 18 },
    floor: '#3b4550',
    light: '#e2f2ff',
    doors: [{ side: 'north', at: 3.5, width: 3.6 }],
  },
  {
    id: 'garagem',
    name: 'Garagem',
    rect: { x: 38, z: 26, w: 14, d: 18 },
    floor: '#2c2f36',
    light: '#ffd9c2',
    doors: [{ side: 'north', at: 5, width: 3.6 }],
  },
  {
    id: 'deposito',
    name: 'Depósito',
    rect: { x: 52, z: 26, w: 12, d: 18 },
    floor: '#4a4235',
    light: '#ffe9bd',
    doors: [{ side: 'north', at: 4, width: 3.6 }],
  },
];

function deskCluster(x: number, z: number, rot: number): PropDef[] {
  return [
    { kind: 'desk', x, z, rot },
    { kind: 'monitor', x, z: z - 0.35, rot },
    { kind: 'chair', x, z: z + 1.3, rot },
  ];
}

function buildProps(): PropDef[] {
  const props: PropDef[] = [
    // Recepção
    { kind: 'counter', x: 8, z: 4.5, rot: 0 },
    { kind: 'sofa', x: 3.5, z: 13, rot: 0 },
    { kind: 'sofa', x: 12.5, z: 13, rot: Math.PI },
    { kind: 'plant', x: 1.6, z: 1.8, rot: 0 },
    { kind: 'plant', x: 14.4, z: 1.8, rot: 0 },
    { kind: 'plant', x: 1.6, z: 17.5, rot: 0 },
    // Sala de reunião
    { kind: 'meetingTable', x: 46, z: 8, rot: 0 },
    { kind: 'whiteboard', x: 46, z: 0.9, rot: 0 },
    { kind: 'plant', x: 50.4, z: 17.6, rot: 0 },
    // Copa
    { kind: 'coffee', x: 62.2, z: 3.4, rot: -Math.PI / 2 },
    { kind: 'vending', x: 62.2, z: 7.4, rot: -Math.PI / 2 },
    { kind: 'sink', x: 53.6, z: 3.4, rot: Math.PI / 2 },
    { kind: 'meetingTable', x: 58, z: 13, rot: 0 },
    { kind: 'plant', x: 53.4, z: 17.6, rot: 0 },
    // Corredor
    { kind: 'plant', x: 20.5, z: 24.2, rot: 0 },
    { kind: 'plant', x: 41.5, z: 21.6, rot: 0 },
    { kind: 'printer', x: 12, z: 21.4, rot: 0 },
    // Arquivo
    { kind: 'locker', x: 2, z: 30, rot: Math.PI / 2 },
    { kind: 'locker', x: 2, z: 34, rot: Math.PI / 2 },
    { kind: 'locker', x: 2, z: 38, rot: Math.PI / 2 },
    { kind: 'locker', x: 12, z: 30, rot: -Math.PI / 2 },
    { kind: 'locker', x: 12, z: 34, rot: -Math.PI / 2 },
    { kind: 'shelf', x: 7, z: 41.5, rot: 0 },
    // Servidores
    { kind: 'rack', x: 17, z: 30, rot: 0 },
    { kind: 'rack', x: 20, z: 30, rot: 0 },
    { kind: 'rack', x: 23, z: 30, rot: 0 },
    { kind: 'rack', x: 26, z: 30, rot: 0 },
    { kind: 'rack', x: 17, z: 38, rot: Math.PI },
    { kind: 'rack', x: 20, z: 38, rot: Math.PI },
    { kind: 'rack', x: 23, z: 38, rot: Math.PI },
    // Banheiros
    { kind: 'sink', x: 29.6, z: 29, rot: Math.PI / 2 },
    { kind: 'sink', x: 29.6, z: 32, rot: Math.PI / 2 },
    { kind: 'sink', x: 29.6, z: 35, rot: Math.PI / 2 },
    // Garagem
    { kind: 'car', x: 42.5, z: 34, rot: 0 },
    { kind: 'car', x: 48, z: 34, rot: 0 },
    { kind: 'cone', x: 45.2, z: 28.6, rot: 0 },
    { kind: 'cone', x: 46.4, z: 29.4, rot: 0 },
    { kind: 'crate', x: 40.5, z: 42, rot: 0 },
    // Depósito
    { kind: 'shelf', x: 54.5, z: 30, rot: 0 },
    { kind: 'shelf', x: 54.5, z: 36, rot: 0 },
    { kind: 'shelf', x: 61.5, z: 30, rot: Math.PI },
    { kind: 'crate', x: 58, z: 41, rot: 0.4 },
    { kind: 'crate', x: 59.4, z: 40.2, rot: -0.2 },
    { kind: 'crate', x: 57.2, z: 39.4, rot: 0.9 },
  ];

  // Open space: quatro fileiras de mesas viradas de costas uma para a outra.
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const x = 19.5 + column * 5.2;
      const z = 5 + row * 9;
      props.push(...deskCluster(x, z, 0));
      props.push(...deskCluster(x, z + 4, Math.PI));
    }
  }
  return props;
}

const TASK_SPOTS: TaskSpot[] = [
  { id: 'rack-a', kind: 'rack', room: 'servidores', label: 'Religar o rack principal', x: 21.5, z: 32.4 },
  { id: 'rack-b', kind: 'rack', room: 'servidores', label: 'Trocar o disco do backup', x: 25.5, z: 35.8 },
  { id: 'cabos-a', kind: 'cabos', room: 'servidores', label: 'Refazer o cabeamento', x: 17.5, z: 35.8 },
  { id: 'arquivo-a', kind: 'arquivo', room: 'arquivo', label: 'Arquivar os contratos', x: 4.4, z: 31.5 },
  { id: 'arquivo-b', kind: 'arquivo', room: 'arquivo', label: 'Separar as notas fiscais', x: 9.6, z: 36.5 },
  { id: 'senha-a', kind: 'senha', room: 'openspace', label: 'Destravar o PC da mesa 3', x: 24.7, z: 6.4 },
  { id: 'senha-b', kind: 'senha', room: 'openspace', label: 'Destravar o PC da mesa 7', x: 35.1, z: 15.4 },
  { id: 'cabos-b', kind: 'cabos', room: 'openspace', label: 'Ligar o cabo do projetor', x: 19.5, z: 15.4 },
  { id: 'cafe-a', kind: 'cafe', room: 'copa', label: 'Calibrar a cafeteira', x: 61, z: 3.4 },
  { id: 'estoque-a', kind: 'estoque', room: 'copa', label: 'Repor o estoque da copa', x: 61, z: 7.4 },
  { id: 'impressora-a', kind: 'impressora', room: 'corredor', label: 'Desatolar a impressora', x: 12, z: 22.4 },
  { id: 'senha-c', kind: 'senha', room: 'recepcao', label: 'Fechar o caixa da recepção', x: 8, z: 5.8 },
  { id: 'estoque-b', kind: 'estoque', room: 'deposito', label: 'Conferir o inventário', x: 56.5, z: 31 },
  { id: 'cabos-c', kind: 'cabos', room: 'garagem', label: 'Recarregar o carro da empresa', x: 45.2, z: 34 },
];

const VENTS: VentDef[] = [
  { id: 'vent-servidores', room: 'servidores', x: 26.4, z: 42.2, links: ['vent-arquivo', 'vent-copa'] },
  { id: 'vent-arquivo', room: 'arquivo', x: 1.8, z: 42.2, links: ['vent-servidores', 'vent-garagem'] },
  { id: 'vent-copa', room: 'copa', x: 62.4, z: 17.6, links: ['vent-servidores', 'vent-garagem'] },
  { id: 'vent-garagem', room: 'garagem', x: 50.4, z: 42, links: ['vent-copa', 'vent-arquivo'] },
];

export const OFFICE_MAP: GameMap = {
  name: 'Escritório Timbas',
  bounds: { x: 0, z: 0, w: 64, d: 44 },
  rooms: ROOMS,
  walls: buildWalls(ROOMS),
  props: buildProps(),
  taskSpots: TASK_SPOTS,
  vents: VENTS,
  emergency: { x: 8, z: 9.5 },
  spawns: [
    { x: 5, z: 9 },
    { x: 11, z: 9 },
    { x: 5, z: 12 },
    { x: 11, z: 12 },
    { x: 8, z: 14 },
    { x: 3.5, z: 15.5 },
    { x: 12.5, z: 15.5 },
    { x: 6.5, z: 17 },
    { x: 9.5, z: 17 },
    { x: 4, z: 6.5 },
    { x: 12, z: 6.5 },
    { x: 8, z: 17.8 },
  ],
};

export function roomAt(x: number, z: number): RoomDef | null {
  return (
    ROOMS.find(
      (room) =>
        x >= room.rect.x &&
        x <= room.rect.x + room.rect.w &&
        z >= room.rect.z &&
        z <= room.rect.z + room.rect.d,
    ) ?? null
  );
}

export function taskSpotById(id: string): TaskSpot | undefined {
  return TASK_SPOTS.find((spot) => spot.id === id);
}

export function ventById(id: string): VentDef | undefined {
  return VENTS.find((vent) => vent.id === id);
}
