/// O escritório onde a partida acontece. Este arquivo é a única fonte da
/// verdade do mapa: o servidor usa as paredes para colisão e os pontos de
/// tarefa para validar o que o jogador diz que fez, e o navegador baixa o mesmo
/// JSON para desenhar a cena. Duas cópias do mapa viravam duas verdades.
///
/// Eixos: x cresce para leste, z cresce para o sul. Uma unidade é um metro.
///
/// O escritório não é um bloco maciço. As salas são ilhas soltas no vazio,
/// ligadas por um corredor largo que atravessa o mapa inteiro e por passagens
/// curtas que cruzam o vão até cada porta. O espaço vazio entre uma sala e
/// outra é tão parte do desenho quanto as paredes: é ele que separa os cômodos
/// na leitura de cima e dá fôlego para a câmera.

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

export type RoomKind = 'sala' | 'corredor' | 'terraco';

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
  targetLevel: number;
  targetX: number;
  targetZ: number;
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
  emergency: { x: number; z: number; level?: number };
  spawns: { x: number; z: number; level?: number }[];
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
    if (side === 'north') return { minX: x + from, minZ: z - HALF, maxX: x + to, maxZ: z + HALF };
    if (side === 'south') return { minX: x + from, minZ: z + d - HALF, maxX: x + to, maxZ: z + d + HALF };
    if (side === 'west') return { minX: x - HALF, minZ: z + from, maxX: x + HALF, maxZ: z + to };
    return { minX: x + w - HALF, minZ: z + from, maxX: x + w + HALF, maxZ: z + to };
  });
}

function buildWalls(rooms: RoomDef[]): WallBox[] {
  return rooms.flatMap((room) =>
    (['north', 'south', 'east', 'west'] as Side[]).flatMap((side) =>
      segmentsFor(room, side).map((box) => ({
        ...box,
        accent: room.light,
        level: room.level ?? 0,
        style: room.kind === 'terraco' ? ('guarda-corpo' as const) : ('parede' as const),
      })),
    ),
  );
}

interface Link {
  a: string;
  b: string;
}

/// Duas salas encostadas se abrem uma para a outra na largura inteira do
/// encosto. Escrever a porta à mão dos dois lados era o que mais dava errado no
/// mapa antigo: bastava errar meio metro para a porta de um lado bater na
/// parede do outro, ou para as duas paredes ficarem no mesmo plano brigando por
/// pixel. Aqui o encosto é medido e vira o vão inteiro, então nenhum dos dois
/// tem como acontecer, e de quebra a passagem fica larga.
function openLinks(rooms: RoomDef[], links: Link[]) {
  const byId = new Map(rooms.map((room) => [room.id, room]));

  for (const link of links) {
    const a = byId.get(link.a);
    const b = byId.get(link.b);
    if (!a || !b) throw new Error(`Ligação com sala inexistente: ${link.a} + ${link.b}`);

    const aSouth = a.rect.z + a.rect.d === b.rect.z;
    const aNorth = b.rect.z + b.rect.d === a.rect.z;
    const aEast = a.rect.x + a.rect.w === b.rect.x;
    const aWest = b.rect.x + b.rect.w === a.rect.x;

    if (aSouth || aNorth) {
      const from = Math.max(a.rect.x, b.rect.x);
      const to = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w);
      if (to <= from) throw new Error(`Salas ${a.id} e ${b.id} se tocam sem sobrepor`);
      a.doors.push({ side: aSouth ? 'south' : 'north', at: from - a.rect.x, width: to - from });
      b.doors.push({ side: aSouth ? 'north' : 'south', at: from - b.rect.x, width: to - from });
      continue;
    }

    if (aEast || aWest) {
      const from = Math.max(a.rect.z, b.rect.z);
      const to = Math.min(a.rect.z + a.rect.d, b.rect.z + b.rect.d);
      if (to <= from) throw new Error(`Salas ${a.id} e ${b.id} se tocam sem sobrepor`);
      a.doors.push({ side: aEast ? 'east' : 'west', at: from - a.rect.z, width: to - from });
      b.doors.push({ side: aEast ? 'west' : 'east', at: from - b.rect.z, width: to - from });
      continue;
    }

    throw new Error(`Salas ${a.id} e ${b.id} não se encostam`);
  }
}

const CIRCULACAO = '#d6dce7';

function passagem(id: string, x: number, z: number, accent: string): RoomDef {
  return {
    id,
    name: 'Passagem',
    rect: { x, z, w: 5, d: 5 },
    kind: 'corredor',
    floor: CIRCULACAO,
    light: accent,
    doors: [],
  };
}

/// Dois pavimentos em volta de um salão central. Não existe mais um corredor
/// reto atravessando o mapa inteiro: toda ala tem pelo menos duas rotas e as
/// duas escadas ficam em lados opostos do átrio.
const ROOMS: RoomDef[] = [
  {
    id: 'servidores',
    name: 'Sala dos servidores',
    rect: { x: 3, z: 3, w: 20, d: 14 },
    kind: 'sala',
    floor: '#cbdbe8',
    light: '#38bdf8',
    doors: [],
  },
  {
    id: 'openspace',
    name: 'Open space',
    rect: { x: 23, z: 3, w: 28, d: 14 },
    kind: 'sala',
    floor: '#e4e9f1',
    light: '#38bdf8',
    doors: [],
  },
  {
    id: 'reuniao',
    name: 'Sala de reunião',
    rect: { x: 51, z: 3, w: 20, d: 14 },
    kind: 'sala',
    floor: '#eee2cf',
    light: '#f6a35c',
    doors: [],
  },
  {
    id: 'recepcao',
    name: 'Recepção',
    rect: { x: 3, z: 17, w: 16, d: 18 },
    kind: 'sala',
    floor: '#dfe5ef',
    light: '#7aa2f7',
    doors: [],
  },
  {
    id: 'hall-central',
    name: 'Átrio central',
    rect: { x: 19, z: 17, w: 36, d: 24 },
    kind: 'sala',
    floor: '#e6e9ee',
    light: '#93c5fd',
    doors: [],
  },
  {
    id: 'copa',
    name: 'Copa',
    rect: { x: 55, z: 17, w: 16, d: 18 },
    kind: 'sala',
    floor: '#dcecdf',
    light: '#4ade80',
    doors: [],
  },
  {
    id: 'garagem',
    name: 'Garagem',
    rect: { x: 3, z: 35, w: 16, d: 20 },
    kind: 'sala',
    floor: '#d4d7de',
    light: '#fb923c',
    doors: [],
  },
  {
    id: 'deposito',
    name: 'Depósito',
    rect: { x: 55, z: 35, w: 16, d: 20 },
    kind: 'sala',
    floor: '#ebe4d0',
    light: '#facc15',
    doors: [],
  },

  // Segundo andar
  {
    id: 'arquivo',
    name: 'Arquivo executivo',
    rect: { x: 3, z: 3, w: 20, d: 14 },
    kind: 'sala',
    level: 1,
    floor: '#e6e0f0',
    light: '#c084fc',
    doors: [],
  },
  {
    id: 'operacoes',
    name: 'Central de operações',
    rect: { x: 23, z: 3, w: 28, d: 14 },
    kind: 'sala',
    level: 1,
    floor: '#d9e7f2',
    light: '#22d3ee',
    doors: [],
  },
  {
    id: 'chefe',
    name: 'Sala do chefe',
    rect: { x: 51, z: 3, w: 20, d: 14 },
    kind: 'sala',
    level: 1,
    floor: '#eadfce',
    light: '#f59e0b',
    doors: [],
  },
  {
    id: 'lounge',
    name: 'Lounge',
    rect: { x: 3, z: 17, w: 16, d: 18 },
    kind: 'sala',
    level: 1,
    floor: '#dce8e4',
    light: '#34d399',
    doors: [],
  },
  {
    id: 'hall-superior',
    name: 'Mezanino',
    rect: { x: 19, z: 17, w: 36, d: 24 },
    kind: 'sala',
    level: 1,
    floor: '#dfe5ef',
    light: '#818cf8',
    doors: [],
  },
  {
    id: 'terraco',
    name: 'Terraço',
    rect: { x: 55, z: 17, w: 16, d: 38 },
    kind: 'terraco',
    level: 1,
    floor: '#b8c4bf',
    light: '#86efac',
    doors: [],
  },
  {
    id: 'conselho',
    name: 'Sala do conselho',
    rect: { x: 3, z: 35, w: 16, d: 20 },
    kind: 'sala',
    level: 1,
    floor: '#e6dfd4',
    light: '#f0abfc',
    doors: [],
  },
];

const LINKS: Link[] = [
  { a: 'servidores', b: 'hall-central' },
  { a: 'openspace', b: 'hall-central' },
  { a: 'reuniao', b: 'hall-central' },
  { a: 'recepcao', b: 'hall-central' },
  { a: 'copa', b: 'hall-central' },
  { a: 'garagem', b: 'hall-central' },
  { a: 'deposito', b: 'hall-central' },
  { a: 'arquivo', b: 'hall-superior' },
  { a: 'operacoes', b: 'hall-superior' },
  { a: 'chefe', b: 'hall-superior' },
  { a: 'lounge', b: 'hall-superior' },
  { a: 'terraco', b: 'hall-superior' },
  { a: 'conselho', b: 'hall-superior' },
];

openLinks(ROOMS, LINKS);

function deskCluster(x: number, z: number, rot: number): PropDef[] {
  return [
    { kind: 'desk', x, z, rot },
    { kind: 'monitor', x, z: z - 0.35, rot },
    { kind: 'chair', x, z: z + 1.3, rot },
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
    { kind: 'sofa', x: 29, z: 29, rot: Math.PI / 2 },
    { kind: 'sofa', x: 45, z: 29, rot: -Math.PI / 2 },
    { kind: 'plant', x: 21, z: 19, rot: 0 },
    { kind: 'plant', x: 53, z: 39, rot: 0 },
    { kind: 'coffee', x: 37, z: 20, rot: 0 },
    { kind: 'printer', x: 37, z: 38, rot: Math.PI },

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
    { kind: 'meetingTable', x: 61, z: 9, rot: 0 },
    { kind: 'chair', x: 59.4, z: 7.6, rot: 0 },
    { kind: 'chair', x: 61, z: 7.6, rot: 0 },
    { kind: 'chair', x: 62.6, z: 7.6, rot: 0 },
    { kind: 'chair', x: 59.4, z: 10.4, rot: Math.PI },
    { kind: 'chair', x: 61, z: 10.4, rot: Math.PI },
    { kind: 'chair', x: 62.6, z: 10.4, rot: Math.PI },
    { kind: 'whiteboard', x: 61, z: 4.1, rot: 0 },
    { kind: 'coffee', x: 68.5, z: 20, rot: -Math.PI / 2 },
    { kind: 'vending', x: 68.5, z: 24, rot: -Math.PI / 2 },
    { kind: 'sink', x: 57, z: 20, rot: Math.PI / 2 },
    { kind: 'meetingTable', x: 63, z: 30, rot: 0 },
    { kind: 'plant', x: 69, z: 33, rot: 0 },

    // Térreo: garagem e depósito
    { kind: 'car', x: 8, z: 45.5, rot: 0 },
    { kind: 'car', x: 14, z: 45.5, rot: 0 },
    { kind: 'cone', x: 10.8, z: 52.5, rot: 0 },
    { kind: 'cone', x: 12, z: 51.5, rot: 0 },
    { kind: 'crate', x: 5, z: 53, rot: 0.2 },
    { kind: 'shelf', x: 58, z: 39, rot: Math.PI / 2 },
    { kind: 'shelf', x: 68, z: 39, rot: -Math.PI / 2 },
    { kind: 'shelf', x: 58, z: 50, rot: Math.PI / 2 },
    { kind: 'crate', x: 64, z: 51, rot: 0.3 },
    { kind: 'crate', x: 66, z: 52, rot: -0.3 },

    // Segundo andar: arquivo, lounge e mezanino
    { kind: 'locker', x: 5, z: 6, rot: Math.PI / 2, level: 1 },
    { kind: 'locker', x: 5, z: 10, rot: Math.PI / 2, level: 1 },
    { kind: 'locker', x: 21, z: 6, rot: -Math.PI / 2, level: 1 },
    { kind: 'shelf', x: 12, z: 15, rot: 0, level: 1 },
    { kind: 'sofa', x: 8, z: 24, rot: 0, level: 1 },
    { kind: 'sofa', x: 14, z: 30, rot: Math.PI, level: 1 },
    { kind: 'vending', x: 17, z: 20, rot: -Math.PI / 2, level: 1 },
    { kind: 'plant', x: 5, z: 33, rot: 0, level: 1 },
    { kind: 'sofa', x: 30, z: 29, rot: Math.PI / 2, level: 1 },
    { kind: 'sofa', x: 44, z: 29, rot: -Math.PI / 2, level: 1 },
    { kind: 'plant', x: 21, z: 39, rot: 0, level: 1 },
    { kind: 'plant', x: 53, z: 19, rot: 0, level: 1 },

    // Segundo andar: sala do chefe
    { kind: 'desk', x: 61, z: 8, rot: 0, level: 1 },
    { kind: 'monitor', x: 61, z: 7.65, rot: 0, level: 1 },
    { kind: 'chair', x: 61, z: 9.3, rot: 0, level: 1 },
    { kind: 'sofa', x: 55, z: 13.5, rot: Math.PI / 2, level: 1 },
    { kind: 'meetingTable', x: 67, z: 12.5, rot: Math.PI / 2, level: 1 },
    { kind: 'plant', x: 69, z: 5, rot: 0, level: 1 },
    { kind: 'whiteboard', x: 61, z: 4.1, rot: 0, level: 1 },

    // Segundo andar: terraço e conselho
    { kind: 'meetingTable', x: 63, z: 24, rot: Math.PI / 2, level: 1 },
    { kind: 'meetingTable', x: 63, z: 36, rot: Math.PI / 2, level: 1 },
    { kind: 'sofa', x: 66, z: 48, rot: Math.PI, level: 1 },
    { kind: 'plant', x: 57, z: 20, rot: 0, level: 1 },
    { kind: 'plant', x: 69, z: 31, rot: 0, level: 1 },
    { kind: 'plant', x: 57, z: 52, rot: 0, level: 1 },
    { kind: 'meetingTable', x: 11, z: 45, rot: Math.PI / 2, level: 1 },
    { kind: 'chair', x: 8.8, z: 45, rot: -Math.PI / 2, level: 1 },
    { kind: 'chair', x: 13.2, z: 45, rot: Math.PI / 2, level: 1 },
    { kind: 'whiteboard', x: 11, z: 53.8, rot: Math.PI, level: 1 },
  ];

  // Estações no térreo e na central de operações do piso superior.
  for (const level of [0, 1]) {
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const x = 27 + column * 6.2;
        const z = 6 + row * 6;
        for (const item of deskCluster(x, z, row ? Math.PI : 0)) props.push({ ...item, level });
      }
    }
  }
  return props;
}

const TASK_SPOTS: TaskSpot[] = [
  { id: 'rack-a', kind: 'rack', room: 'servidores', label: 'Religar o rack principal', x: 8, z: 8 },
  { id: 'rack-b', kind: 'rack', room: 'servidores', label: 'Trocar o disco do backup', x: 17, z: 12 },
  { id: 'cabos-a', kind: 'cabos', room: 'servidores', label: 'Refazer o cabeamento', x: 12, z: 14.5 },
  { id: 'senha-a', kind: 'senha', room: 'openspace', label: 'Destravar a estação 3', x: 33.2, z: 4.5 },
  { id: 'senha-b', kind: 'senha', room: 'openspace', label: 'Reiniciar a estação 7', x: 47.2, z: 12.8 },
  { id: 'cafe-a', kind: 'cafe', room: 'copa', label: 'Calibrar a cafeteira', x: 67, z: 20 },
  { id: 'estoque-a', kind: 'estoque', room: 'copa', label: 'Repor a máquina de venda', x: 67, z: 24 },
  { id: 'senha-c', kind: 'senha', room: 'recepcao', label: 'Fechar o caixa da recepção', x: 10.5, z: 22.2 },
  { id: 'estoque-b', kind: 'estoque', room: 'deposito', label: 'Conferir o inventário', x: 63, z: 48 },
  { id: 'cabos-c', kind: 'cabos', room: 'garagem', label: 'Recarregar o carro da empresa', x: 8, z: 42.5 },
  { id: 'arquivo-a', kind: 'arquivo', room: 'arquivo', label: 'Arquivar os contratos', x: 7, z: 8, level: 1 },
  { id: 'arquivo-b', kind: 'arquivo', room: 'arquivo', label: 'Separar os documentos sigilosos', x: 16, z: 14, level: 1 },
  { id: 'senha-d', kind: 'senha', room: 'operacoes', label: 'Autorizar o painel de operações', x: 41, z: 12.8, level: 1 },
  { id: 'senha-chefe', kind: 'senha', room: 'chefe', label: 'Liberar o terminal do chefe', x: 63, z: 8, level: 1 },
  { id: 'cabos-conselho', kind: 'cabos', room: 'conselho', label: 'Ligar a tela do conselho', x: 11, z: 52.5, level: 1 },
];

/// Quanto cada móvel ocupa do chão, e se ele chega alto o bastante para
/// esconder alguém atrás. Este tamanho é a lei: o servidor barra o passo por
/// ele e o navegador desenha a peça em cima dele. Móvel que não aparece aqui é
/// atravessável de propósito (o monitor fica em cima da mesa, o cone se chuta).
const FOOTPRINTS: Partial<Record<PropKind, { w: number; d: number; tall?: boolean }>> = {
  desk: { w: 1.7, d: 0.85 },
  chair: { w: 0.55, d: 0.55 },
  plant: { w: 0.52, d: 0.52 },
  sofa: { w: 2.0, d: 0.9 },
  counter: { w: 4.5, d: 1.1 },
  meetingTable: { w: 3.8, d: 1.7 },
  rack: { w: 0.8, d: 1.0, tall: true },
  locker: { w: 1.1, d: 0.55, tall: true },
  shelf: { w: 2.6, d: 0.6, tall: true },
  coffee: { w: 0.7, d: 0.6 },
  crate: { w: 1.0, d: 1.0 },
  printer: { w: 0.9, d: 0.7 },
  whiteboard: { w: 2.7, d: 0.12 },
  car: { w: 2.0, d: 4.3, tall: true },
  sink: { w: 1.7, d: 0.6 },
  vending: { w: 1.1, d: 0.75, tall: true },
};

/// O móvel girado continua sendo barrado por uma caixa alinhada aos eixos: é a
/// menor caixa reta que cabe o retângulo girado. Girar a colisão junto sairia
/// mais caro em todo quadro de todo jogador para ganhar centímetros.
function buildObstacles(props: PropDef[]): WallBox[] {
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
      tall: size.tall,
      level: prop.level ?? 0,
    });
  }
  return boxes;
}

const VENTS: VentDef[] = [
  { id: 'vent-servidores', room: 'servidores', x: 21, z: 15, links: ['vent-garagem', 'vent-operacoes'] },
  { id: 'vent-garagem', room: 'garagem', x: 17, z: 53, links: ['vent-servidores', 'vent-terraco'] },
  { id: 'vent-operacoes', room: 'operacoes', x: 49, z: 15, level: 1, links: ['vent-servidores', 'vent-chefe'] },
  { id: 'vent-chefe', room: 'chefe', x: 69, z: 15, level: 1, links: ['vent-operacoes', 'vent-terraco'] },
  { id: 'vent-terraco', room: 'terraco', x: 69, z: 53, level: 1, links: ['vent-chefe', 'vent-garagem'] },
];

const STAIRS: StairDef[] = [
  { id: 'escada-oeste-terreo', level: 0, x: 24, z: 22, rot: 0, targetLevel: 1, targetX: 24, targetZ: 27 },
  { id: 'escada-oeste-superior', level: 1, x: 24, z: 22, rot: 0, targetLevel: 0, targetX: 24, targetZ: 27 },
  { id: 'escada-leste-terreo', level: 0, x: 50, z: 36, rot: Math.PI, targetLevel: 1, targetX: 50, targetZ: 31 },
  { id: 'escada-leste-superior', level: 1, x: 50, z: 36, rot: Math.PI, targetLevel: 0, targetX: 50, targetZ: 31 },
];

const PROPS_BUILT = buildProps();
const WALLS_BUILT = buildWalls(ROOMS);
const OBSTACLES_BUILT = buildObstacles(PROPS_BUILT);

export const OFFICE_MAP: GameMap = {
  name: 'Escritório Timbas',
  bounds: { x: 0, z: 0, w: 74, d: 58 },
  rooms: ROOMS,
  walls: WALLS_BUILT,
  obstacles: OBSTACLES_BUILT,
  props: PROPS_BUILT,
  taskSpots: TASK_SPOTS,
  vents: VENTS,
  stairs: STAIRS,
  emergency: { x: 37, z: 29, level: 0 },
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
    { x: 43, z: 32, level: 0 },
  ],
};

/// Tudo em que se esbarra: parede e móvel. Somado uma vez só, porque a conta
/// roda para cada jogador em cada quadro.
export const COLLIDERS: WallBox[] = [...WALLS_BUILT, ...OBSTACLES_BUILT];

/// O que tapa a vista: parede e móvel alto. A mesa fica de fora porque quem
/// está atrás dela continua à vista.
export const SIGHT_BLOCKERS: WallBox[] = [...WALLS_BUILT, ...OBSTACLES_BUILT.filter((box) => box.tall)];

export function collidersFor(level: number): WallBox[] {
  return COLLIDERS.filter((box) => (box.level ?? 0) === level);
}

export function sightBlockersFor(level: number): WallBox[] {
  return SIGHT_BLOCKERS.filter(
    (box) => (box.level ?? 0) === level && box.style !== 'guarda-corpo',
  );
}

export function roomAt(x: number, z: number, level = 0): RoomDef | null {
  return (
    ROOMS.find(
      (room) =>
        (room.level ?? 0) === level &&
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
