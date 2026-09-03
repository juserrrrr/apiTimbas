import { OFFICE_MAP } from './map';
import { clampStep, hasLineOfSight, moveTowards, resolveCollisions } from './movement';

const wall = [{ minX: 10, minZ: 0, maxX: 10.4, maxZ: 20 }];

describe('clampStep', () => {
  it('corta o passo no que cabe no tempo', () => {
    const next = clampStep({ x: 0, z: 0 }, { x: 100, z: 0 }, 2);
    expect(next.x).toBeCloseTo(2);
  });

  it('passo curto passa inteiro', () => {
    const next = clampStep({ x: 0, z: 0 }, { x: 1, z: 0 }, 2);
    expect(next.x).toBeCloseTo(1);
  });
});

describe('resolveCollisions', () => {
  it('tira o jogador de dentro da parede', () => {
    const next = resolveCollisions({ x: 10.2, z: 5 }, wall);
    expect(next.x).toBeLessThan(10);
  });

  it('quem está longe da parede não é empurrado', () => {
    const next = resolveCollisions({ x: 4, z: 5 }, wall);
    expect(next).toEqual({ x: 4, z: 5 });
  });
});

describe('moveTowards', () => {
  it('não atravessa a parede nem com passo grande', () => {
    const next = moveTowards({ x: 8, z: 5 }, { x: 14, z: 5 }, 6, wall);
    expect(next.x).toBeLessThan(10);
  });

  it('desliza pela parede em vez de travar', () => {
    const next = moveTowards({ x: 9.4, z: 5 }, { x: 10.4, z: 7 }, 3, wall);
    expect(next.z).toBeGreaterThan(5);
  });
});

describe('hasLineOfSight', () => {
  it('parede no meio corta a visão', () => {
    expect(hasLineOfSight({ x: 8, z: 5 }, { x: 12, z: 5 }, wall)).toBe(false);
  });

  it('sem nada no caminho enxerga', () => {
    expect(hasLineOfSight({ x: 2, z: 5 }, { x: 8, z: 5 }, wall)).toBe(true);
  });
});

describe('o escritório', () => {
  it('nasce com todo mundo em pé fora de parede', () => {
    for (const spawn of OFFICE_MAP.spawns) {
      expect(resolveCollisions(spawn, OFFICE_MAP.walls)).toEqual(spawn);
    }
  });

  it('deixa cada ponto de tarefa alcançável de fora da parede', () => {
    for (const spot of OFFICE_MAP.taskSpots) {
      expect(resolveCollisions({ x: spot.x, z: spot.z }, OFFICE_MAP.walls)).toEqual({ x: spot.x, z: spot.z });
    }
  });

  it('deixa toda sala alcançável a pé desde o nascimento', () => {
    // As salas viraram ilhas separadas por vazio, então uma passagem fora do
    // lugar não deixa mais um buraco visível: deixa um cômodo mudo, que só
    // aparece quando alguém recebe tarefa lá e não consegue chegar. Este
    // caminhamento anda de meio em meio metro pelo mapa e cobra que todas as
    // salas apareçam a partir do ponto onde os jogadores nascem.
    const STEP = 0.5;
    const { x: originX, z: originZ, w, d } = OFFICE_MAP.bounds;
    const columns = Math.round(w / STEP);
    const rows = Math.round(d / STEP);
    const key = (column: number, row: number) => row * columns + column;

    const walkable = (column: number, row: number) => {
      const point = { x: originX + column * STEP, z: originZ + row * STEP };
      const resolved = resolveCollisions(point, OFFICE_MAP.walls);
      return Math.abs(resolved.x - point.x) < 1e-9 && Math.abs(resolved.z - point.z) < 1e-9;
    };

    const seen = new Set<number>();
    const queue: [number, number][] = [];
    for (const spawn of OFFICE_MAP.spawns) {
      const column = Math.round((spawn.x - originX) / STEP);
      const row = Math.round((spawn.z - originZ) / STEP);
      if (seen.has(key(column, row))) continue;
      seen.add(key(column, row));
      queue.push([column, row]);
    }

    while (queue.length > 0) {
      const [column, row] = queue.pop()!;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nextColumn = column + dx;
        const nextRow = row + dz;
        if (nextColumn < 0 || nextRow < 0 || nextColumn > columns || nextRow > rows) continue;
        if (seen.has(key(nextColumn, nextRow))) continue;
        if (!walkable(nextColumn, nextRow)) continue;
        seen.add(key(nextColumn, nextRow));
        queue.push([nextColumn, nextRow]);
      }
    }

    const reached = new Set<string>();
    for (const cell of seen) {
      const column = cell % columns;
      const row = (cell - column) / columns;
      const x = originX + column * STEP;
      const z = originZ + row * STEP;
      for (const room of OFFICE_MAP.rooms) {
        if (
          x >= room.rect.x &&
          x <= room.rect.x + room.rect.w &&
          z >= room.rect.z &&
          z <= room.rect.z + room.rect.d
        ) {
          reached.add(room.id);
        }
      }
    }

    const ilhadas = OFFICE_MAP.rooms.filter((room) => !reached.has(room.id)).map((room) => room.id);
    expect(ilhadas).toEqual([]);
  });

  it('liga os dutos nos dois sentidos', () => {
    for (const vent of OFFICE_MAP.vents) {
      for (const link of vent.links) {
        const other = OFFICE_MAP.vents.find((candidate) => candidate.id === link);
        expect(other?.links).toContain(vent.id);
      }
    }
  });
});
