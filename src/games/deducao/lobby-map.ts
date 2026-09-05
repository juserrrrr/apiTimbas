import type { GameMap, WallBox } from './map';

const obstacles: WallBox[] = [
  ...[-2, 2].map((x) => ({
    minX: x - 1.2,
    maxX: x + 1.2,
    minZ: 3.3,
    maxZ: 4.6,
    height: 0.9,
  })),
  { minX: -5.8, maxX: -4.7, minZ: -1.5, maxZ: 1.5, height: 1.1 },
  { minX: 4.7, maxX: 5.8, minZ: -1.5, maxZ: 1.5, height: 1.1 },
  ...[-5.2, 5.2].flatMap((x) =>
    [-4.2, 4.2].map((z) => ({
      minX: x - 0.4,
      maxX: x + 0.4,
      minZ: z - 0.4,
      maxZ: z + 0.4,
      height: 1.65,
    })),
  ),
];

export const LOBBY_MAP: GameMap = {
  name: 'Sala de espera',
  bounds: { x: -6, z: -5, w: 12, d: 10 },
  rooms: [
    {
      id: 'lobby',
      name: 'Sala de espera',
      kind: 'sala',
      level: 0,
      rect: { x: -6, z: -5, w: 12, d: 10 },
      floor: '#676b72',
      finish: 'terrazzo',
      light: '#f2d7a0',
      doors: [],
    },
  ],
  walls: [
    { minX: -6.24, maxX: 6.24, minZ: -5.24, maxZ: -5 },
    { minX: -6.24, maxX: 6.24, minZ: 5, maxZ: 5.24 },
    { minX: -6.24, maxX: -6, minZ: -5.24, maxZ: 5.24 },
    { minX: 6, maxX: 6.24, minZ: -5.24, maxZ: 5.24 },
  ],
  obstacles,
  props: [
    ...[-2, 2].map((x) => ({
      kind: 'sofa' as const,
      x,
      z: 3.95,
      rot: Math.PI,
    })),
    { kind: 'counter', x: -5.25, z: 0, rot: Math.PI / 2 },
    { kind: 'locker', x: 5.25, z: 0, rot: -Math.PI / 2 },
    ...[-5.2, 5.2].flatMap((x) =>
      [-4.2, 4.2].map((z) => ({ kind: 'plant' as const, x, z, rot: 0 })),
    ),
  ],
  taskSpots: [],
  vents: [],
  stairs: [],
  meetingSeats: [],
  emergency: { x: 0, z: -4.5, level: 0 },
  spawns: [-1.8, 0, 1.8].flatMap((z) =>
    [-2.4, -0.8, 0.8, 2.4].map((x) => ({ x, z, level: 0 })),
  ),
};
