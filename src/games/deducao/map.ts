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
}

export type Side = 'north' | 'south' | 'east' | 'west';

export interface Door {
  side: Side;
  /// Distância do canto inicial da parede até onde o vão começa.
  at: number;
  width: number;
}

export type RoomKind = 'sala' | 'corredor';

export interface RoomDef {
  id: string;
  name: string;
  rect: Rect;
  /// Cômodo de verdade ou pedaço de circulação. O navegador desenha o piso da
  /// circulação mais baixo e sem tapete, para o corredor não competir com as
  /// salas na leitura de cima.
  kind: RoomKind;
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
  /// A pegada dos móveis no chão. Sai separada das paredes porque nem todo
  /// móvel corta a visão, e porque o navegador desenha parede e móvel de
  /// jeitos diferentes.
  obstacles: WallBox[];
  props: PropDef[];
  taskSpots: TaskSpot[];
  vents: VentDef[];
  emergency: { x: number; z: number };
  spawns: { x: number; z: number }[];
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
      segmentsFor(room, side).map((box) => ({ ...box, accent: room.light })),
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

/// A planta em três faixas: as salas do norte entre z 4 e 24, o corredor entre
/// z 29 e 36, e as salas do sul entre z 41 e 61. Os cinco metros de vão entre
/// uma faixa e a outra são vazio de verdade, atravessado só pelas passagens.
const ROOMS: RoomDef[] = [
  // ── Faixa norte ──
  {
    id: 'recepcao',
    name: 'Recepção',
    rect: { x: 3, z: 4, w: 18, d: 20 },
    kind: 'sala',
    floor: '#dfe5ef',
    light: '#7aa2f7',
    doors: [],
  },
  {
    id: 'openspace',
    name: 'Open space',
    rect: { x: 26, z: 4, w: 26, d: 20 },
    kind: 'sala',
    floor: '#e4e9f1',
    light: '#38bdf8',
    doors: [],
  },
  {
    id: 'reuniao',
    name: 'Sala de reunião',
    rect: { x: 57, z: 4, w: 14, d: 20 },
    kind: 'sala',
    floor: '#eee2cf',
    light: '#f6a35c',
    doors: [],
  },
  {
    id: 'copa',
    name: 'Copa',
    rect: { x: 76, z: 4, w: 16, d: 20 },
    kind: 'sala',
    floor: '#dcecdf',
    light: '#4ade80',
    doors: [],
  },

  // ── Circulação ──
  {
    id: 'corredor',
    name: 'Corredor',
    rect: { x: 3, z: 29, w: 89, d: 7 },
    kind: 'corredor',
    floor: CIRCULACAO,
    light: '#a5b4fc',
    doors: [],
  },
  passagem('pass-recepcao', 9, 24, '#7aa2f7'),
  passagem('pass-openspace-oeste', 31, 24, '#38bdf8'),
  passagem('pass-openspace-leste', 44, 24, '#38bdf8'),
  passagem('pass-reuniao', 61, 24, '#f6a35c'),
  passagem('pass-copa', 81, 24, '#4ade80'),
  passagem('pass-arquivo', 8, 36, '#c084fc'),
  passagem('pass-servidores', 29, 36, '#38bdf8'),
  passagem('pass-banheiros', 48, 36, '#67e8f9'),
  passagem('pass-garagem', 66, 36, '#fb923c'),
  passagem('pass-deposito', 83, 36, '#facc15'),

  // ── Faixa sul ──
  {
    id: 'arquivo',
    name: 'Arquivo',
    rect: { x: 3, z: 41, w: 16, d: 20 },
    kind: 'sala',
    floor: '#e6e0f0',
    light: '#c084fc',
    doors: [],
  },
  {
    id: 'servidores',
    name: 'Sala dos servidores',
    rect: { x: 23, z: 41, w: 18, d: 20 },
    kind: 'sala',
    floor: '#d9e7f2',
    light: '#38bdf8',
    doors: [],
  },
  {
    id: 'banheiros',
    name: 'Banheiros',
    rect: { x: 45, z: 41, w: 12, d: 20 },
    kind: 'sala',
    floor: '#dfeaf0',
    light: '#67e8f9',
    doors: [],
  },
  {
    id: 'garagem',
    name: 'Garagem',
    rect: { x: 61, z: 41, w: 15, d: 20 },
    kind: 'sala',
    floor: '#dadde3',
    light: '#fb923c',
    doors: [],
  },
  {
    id: 'deposito',
    name: 'Depósito',
    rect: { x: 80, z: 41, w: 12, d: 20 },
    kind: 'sala',
    floor: '#ebe4d0',
    light: '#facc15',
    doors: [],
  },
];

const LINKS: Link[] = [
  { a: 'recepcao', b: 'pass-recepcao' },
  { a: 'pass-recepcao', b: 'corredor' },
  { a: 'openspace', b: 'pass-openspace-oeste' },
  { a: 'pass-openspace-oeste', b: 'corredor' },
  { a: 'openspace', b: 'pass-openspace-leste' },
  { a: 'pass-openspace-leste', b: 'corredor' },
  { a: 'reuniao', b: 'pass-reuniao' },
  { a: 'pass-reuniao', b: 'corredor' },
  { a: 'copa', b: 'pass-copa' },
  { a: 'pass-copa', b: 'corredor' },
  { a: 'corredor', b: 'pass-arquivo' },
  { a: 'pass-arquivo', b: 'arquivo' },
  { a: 'corredor', b: 'pass-servidores' },
  { a: 'pass-servidores', b: 'servidores' },
  { a: 'corredor', b: 'pass-banheiros' },
  { a: 'pass-banheiros', b: 'banheiros' },
  { a: 'corredor', b: 'pass-garagem' },
  { a: 'pass-garagem', b: 'garagem' },
  { a: 'corredor', b: 'pass-deposito' },
  { a: 'pass-deposito', b: 'deposito' },
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
    // Recepção
    { kind: 'counter', x: 12, z: 8, rot: 0 },
    { kind: 'sofa', x: 7, z: 17, rot: 0 },
    { kind: 'sofa', x: 17, z: 17, rot: Math.PI },
    { kind: 'plant', x: 4.6, z: 5.6, rot: 0 },
    { kind: 'plant', x: 19.4, z: 5.6, rot: 0 },
    { kind: 'plant', x: 4.6, z: 22.4, rot: 0 },
    // Sala de reunião
    { kind: 'meetingTable', x: 64, z: 12, rot: 0 },
    { kind: 'chair', x: 62.5, z: 10.6, rot: 0 },
    { kind: 'chair', x: 64, z: 10.6, rot: 0 },
    { kind: 'chair', x: 65.5, z: 10.6, rot: 0 },
    { kind: 'chair', x: 62.5, z: 13.4, rot: Math.PI },
    { kind: 'chair', x: 64, z: 13.4, rot: Math.PI },
    { kind: 'chair', x: 65.5, z: 13.4, rot: Math.PI },
    { kind: 'chair', x: 61.5, z: 12, rot: -Math.PI / 2 },
    { kind: 'chair', x: 66.5, z: 12, rot: Math.PI / 2 },
    { kind: 'whiteboard', x: 64, z: 5, rot: 0 },
    { kind: 'plant', x: 58.6, z: 22.4, rot: 0 },
    { kind: 'plant', x: 69.4, z: 22.4, rot: 0 },
    // Copa
    { kind: 'coffee', x: 90.2, z: 7.4, rot: -Math.PI / 2 },
    { kind: 'vending', x: 90.2, z: 11.4, rot: -Math.PI / 2 },
    { kind: 'sink', x: 77.8, z: 7.4, rot: Math.PI / 2 },
    { kind: 'meetingTable', x: 84, z: 17, rot: 0 },
    { kind: 'plant', x: 77.6, z: 22.4, rot: 0 },
    // Corredor. Noventa metros de reta viram esteira rolante se estiverem
    // vazios: cada peça aqui é um ponto de referência para quem descreve na
    // reunião onde estava e por onde o outro passou.
    { kind: 'plant', x: 4.6, z: 30.4, rot: 0 },
    { kind: 'printer', x: 14, z: 30.6, rot: 0 },
    { kind: 'crate', x: 21, z: 34.4, rot: 0.3 },
    { kind: 'plant', x: 25, z: 34.6, rot: 0 },
    { kind: 'coffee', x: 40, z: 30.3, rot: 0 },
    { kind: 'plant', x: 58, z: 30.4, rot: 0 },
    { kind: 'sofa', x: 57, z: 34.2, rot: Math.PI },
    { kind: 'vending', x: 71, z: 30.3, rot: 0 },
    { kind: 'plant', x: 78, z: 34.6, rot: 0 },
    { kind: 'crate', x: 90.5, z: 34.3, rot: -0.2 },
    // Arquivo
    { kind: 'locker', x: 4.5, z: 44, rot: Math.PI / 2 },
    { kind: 'locker', x: 4.5, z: 48, rot: Math.PI / 2 },
    { kind: 'locker', x: 4.5, z: 52, rot: Math.PI / 2 },
    { kind: 'locker', x: 17.5, z: 44, rot: -Math.PI / 2 },
    { kind: 'locker', x: 17.5, z: 48, rot: -Math.PI / 2 },
    { kind: 'shelf', x: 11, z: 58.5, rot: 0 },
    // Servidores
    { kind: 'rack', x: 26, z: 45, rot: 0 },
    { kind: 'rack', x: 29, z: 45, rot: 0 },
    { kind: 'rack', x: 32, z: 45, rot: 0 },
    { kind: 'rack', x: 35, z: 45, rot: 0 },
    { kind: 'rack', x: 38, z: 45, rot: 0 },
    { kind: 'rack', x: 26, z: 55, rot: Math.PI },
    { kind: 'rack', x: 29, z: 55, rot: Math.PI },
    { kind: 'rack', x: 32, z: 55, rot: Math.PI },
    { kind: 'rack', x: 35, z: 55, rot: Math.PI },
    // Banheiros
    { kind: 'sink', x: 46.6, z: 45, rot: Math.PI / 2 },
    { kind: 'sink', x: 46.6, z: 48, rot: Math.PI / 2 },
    { kind: 'sink', x: 46.6, z: 51, rot: Math.PI / 2 },
    { kind: 'plant', x: 55.4, z: 59.4, rot: 0 },
    // Garagem
    { kind: 'car', x: 65, z: 52, rot: 0 },
    { kind: 'car', x: 71, z: 52, rot: 0 },
    { kind: 'cone', x: 68, z: 45, rot: 0 },
    { kind: 'cone', x: 69.2, z: 46, rot: 0 },
    { kind: 'crate', x: 63, z: 58.5, rot: 0 },
    // Depósito
    { kind: 'shelf', x: 83, z: 45, rot: 0 },
    { kind: 'shelf', x: 83, z: 51, rot: 0 },
    { kind: 'shelf', x: 89, z: 45, rot: Math.PI },
    { kind: 'crate', x: 86, z: 58, rot: 0.4 },
    { kind: 'crate', x: 87.4, z: 57.2, rot: -0.2 },
    { kind: 'crate', x: 85.2, z: 56.4, rot: 0.9 },
  ];

  // Open space: quatro fileiras de mesas viradas de costas uma para a outra.
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const x = 30 + column * 5.5;
      const z = 8 + row * 8;
      props.push(...deskCluster(x, z, 0));
      props.push(...deskCluster(x, z + 4, Math.PI));
    }
  }
  return props;
}

const TASK_SPOTS: TaskSpot[] = [
  { id: 'rack-a', kind: 'rack', room: 'servidores', label: 'Religar o rack principal', x: 29, z: 47.5 },
  { id: 'rack-b', kind: 'rack', room: 'servidores', label: 'Trocar o disco do backup', x: 35, z: 52.5 },
  { id: 'cabos-a', kind: 'cabos', room: 'servidores', label: 'Refazer o cabeamento', x: 25.5, z: 52.5 },
  { id: 'arquivo-a', kind: 'arquivo', room: 'arquivo', label: 'Arquivar os contratos', x: 7, z: 45 },
  { id: 'arquivo-b', kind: 'arquivo', room: 'arquivo', label: 'Separar as notas fiscais', x: 14, z: 53 },
  { id: 'senha-a', kind: 'senha', room: 'openspace', label: 'Destravar o PC da mesa 3', x: 32.75, z: 8 },
  { id: 'senha-b', kind: 'senha', room: 'openspace', label: 'Destravar o PC da mesa 7', x: 43.75, z: 16 },
  { id: 'cabos-b', kind: 'cabos', room: 'openspace', label: 'Ligar o cabo do projetor', x: 38.25, z: 21.5 },
  { id: 'cafe-a', kind: 'cafe', room: 'copa', label: 'Calibrar a cafeteira', x: 88.6, z: 7.4 },
  { id: 'estoque-a', kind: 'estoque', room: 'copa', label: 'Repor o estoque da copa', x: 88.6, z: 11.4 },
  { id: 'impressora-a', kind: 'impressora', room: 'corredor', label: 'Desatolar a impressora', x: 14, z: 31.8 },
  { id: 'senha-c', kind: 'senha', room: 'recepcao', label: 'Fechar o caixa da recepção', x: 12, z: 9.4 },
  { id: 'estoque-b', kind: 'estoque', room: 'deposito', label: 'Conferir o inventário', x: 86, z: 47 },
  { id: 'cabos-c', kind: 'cabos', room: 'garagem', label: 'Recarregar o carro da empresa', x: 65, z: 48.5 },
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
    });
  }
  return boxes;
}

const VENTS: VentDef[] = [
  { id: 'vent-servidores', room: 'servidores', x: 39.5, z: 59, links: ['vent-arquivo', 'vent-copa'] },
  { id: 'vent-arquivo', room: 'arquivo', x: 4.5, z: 59, links: ['vent-servidores', 'vent-garagem'] },
  { id: 'vent-copa', room: 'copa', x: 90.5, z: 21.5, links: ['vent-servidores', 'vent-garagem'] },
  { id: 'vent-garagem', room: 'garagem', x: 74.5, z: 59, links: ['vent-copa', 'vent-arquivo'] },
];

const PROPS_BUILT = buildProps();
const WALLS_BUILT = buildWalls(ROOMS);
const OBSTACLES_BUILT = buildObstacles(PROPS_BUILT);

export const OFFICE_MAP: GameMap = {
  name: 'Escritório Timbas',
  bounds: { x: 0, z: 0, w: 95, d: 65 },
  rooms: ROOMS,
  walls: WALLS_BUILT,
  obstacles: OBSTACLES_BUILT,
  props: PROPS_BUILT,
  taskSpots: TASK_SPOTS,
  vents: VENTS,
  emergency: { x: 64, z: 18 },
  spawns: [
    { x: 5.5, z: 12 },
    { x: 8.5, z: 12 },
    { x: 11.5, z: 12 },
    { x: 14.5, z: 12 },
    { x: 17.5, z: 12 },
    { x: 5.5, z: 14.5 },
    { x: 8.5, z: 14.5 },
    { x: 11.5, z: 14.5 },
    { x: 14.5, z: 14.5 },
    { x: 17.5, z: 14.5 },
    { x: 7, z: 20.5 },
    { x: 17, z: 20.5 },
  ],
};

/// Tudo em que se esbarra: parede e móvel. Somado uma vez só, porque a conta
/// roda para cada jogador em cada quadro.
export const COLLIDERS: WallBox[] = [...WALLS_BUILT, ...OBSTACLES_BUILT];

/// O que tapa a vista: parede e móvel alto. A mesa fica de fora porque quem
/// está atrás dela continua à vista.
export const SIGHT_BLOCKERS: WallBox[] = [...WALLS_BUILT, ...OBSTACLES_BUILT.filter((box) => box.tall)];

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
