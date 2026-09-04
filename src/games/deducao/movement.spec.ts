import {
  OFFICE_MAP,
  collidersFor,
  stairProgressAt,
  surfaceHeightAt,
} from './map';
import {
  clampStep,
  hasLineOfSight,
  moveTowards,
  resolveCollisions,
} from './movement';

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

describe('stairProgressAt', () => {
  it('mantém uma altura contínua do primeiro ao último degrau', () => {
    const stair = OFFICE_MAP.stairs.find(
      (candidate) => candidate.targetLevel > candidate.level,
    )!;
    const middle = stairProgressAt(
      (stair.x + stair.targetX) / 2,
      (stair.z + stair.targetZ) / 2,
    );

    expect(stairProgressAt(stair.x, stair.z)?.progress).toBeCloseTo(0);
    expect(middle?.progress).toBeCloseTo(0.5);
    expect(stairProgressAt(stair.targetX, stair.targetZ)?.progress).toBeCloseTo(
      1,
    );
  });

  it('não trata o corredor ao lado como degrau', () => {
    const stair = OFFICE_MAP.stairs.find(
      (candidate) => candidate.targetLevel > candidate.level,
    )!;
    expect(stairProgressAt(stair.x + 2, stair.z)).toBeNull();
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

  it('mantém o avanço ao inverter a direção junto da parede', () => {
    const forward = moveTowards({ x: 9.4, z: 5 }, { x: 10.4, z: 7 }, 3, wall);
    const backward = moveTowards(forward, { x: 10.4, z: 4 }, 3, wall);

    expect(backward.x).toBeLessThan(10);
    expect(backward.z).toBeLessThan(forward.z);
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
  it('permite ficar sobre o sofá depois de um pulo', () => {
    const sofa = OFFICE_MAP.props.find((prop) => prop.kind === 'sofa')!;
    const height = surfaceHeightAt(sofa.x, sofa.z, sofa.level ?? 0);

    expect(height).toBeCloseTo(0.46);
    expect(
      resolveCollisions(
        { x: sofa.x, z: sofa.z },
        collidersFor(sofa.level ?? 0, OFFICE_MAP, height),
      ),
    ).toEqual({ x: sofa.x, z: sofa.z });
  });

  it('nasce com todo mundo em pé fora de parede e de móvel', () => {
    for (const spawn of OFFICE_MAP.spawns) {
      expect(resolveCollisions(spawn, collidersFor(spawn.level ?? 0))).toEqual({
        x: spawn.x,
        z: spawn.z,
      });
    }
  });

  it('deixa cada ponto de tarefa alcançável sem esbarrar em nada', () => {
    for (const spot of OFFICE_MAP.taskSpots) {
      expect(
        resolveCollisions(
          { x: spot.x, z: spot.z },
          collidersFor(spot.level ?? 0),
        ),
      ).toEqual({
        x: spot.x,
        z: spot.z,
      });
    }
  });

  it('deixa cada duto alcançável sem esbarrar em nada', () => {
    for (const vent of OFFICE_MAP.vents) {
      expect(
        resolveCollisions(
          { x: vent.x, z: vent.z },
          collidersFor(vent.level ?? 0),
        ),
      ).toEqual({
        x: vent.x,
        z: vent.z,
      });
    }
  });

  it('mantém entradas e saídas das escadas livres e com caminho de volta', () => {
    for (const stair of OFFICE_MAP.stairs) {
      expect(resolveCollisions(stair, collidersFor(stair.level))).toEqual({
        x: stair.x,
        z: stair.z,
      });
      expect(
        resolveCollisions(
          { x: stair.targetX, z: stair.targetZ },
          collidersFor(stair.targetLevel),
        ),
      ).toEqual({ x: stair.targetX, z: stair.targetZ });

      expect(
        OFFICE_MAP.stairs.some(
          (candidate) =>
            candidate.level === stair.targetLevel &&
            candidate.targetLevel === stair.level,
        ),
      ).toBe(true);
    }
  });

  it('deixa toda sala alcançável a pé desde o nascimento', () => {
    // Uma porta fora do lugar deixa um cômodo mudo, que só apareceria quando
    // alguém recebesse uma tarefa impossível. Este caminhamento anda de meio
    // em meio metro pelos dois pisos e cobra que todos os ambientes apareçam
    // a partir dos spawns ou da saída de uma escada.
    const STEP = 0.5;
    const { x: originX, z: originZ, w, d } = OFFICE_MAP.bounds;
    const columns = Math.round(w / STEP);
    const rows = Math.round(d / STEP);
    const stride = columns + 1;
    const key = (column: number, row: number) => row * stride + column;

    for (const level of [0, 1]) {
      const levelColliders = collidersFor(level);
      const walkable = (column: number, row: number) => {
        const point = { x: originX + column * STEP, z: originZ + row * STEP };
        const resolved = resolveCollisions(point, levelColliders);
        return (
          Math.abs(resolved.x - point.x) < 1e-9 &&
          Math.abs(resolved.z - point.z) < 1e-9
        );
      };

      const starts = [
        ...OFFICE_MAP.spawns.filter((spawn) => (spawn.level ?? 0) === level),
        ...OFFICE_MAP.stairs
          .filter((stair) => stair.targetLevel === level)
          .map((stair) => ({ x: stair.targetX, z: stair.targetZ })),
      ];
      const seen = new Set<number>();
      const queue: [number, number][] = [];
      for (const start of starts) {
        const column = Math.round((start.x - originX) / STEP);
        const row = Math.round((start.z - originZ) / STEP);
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
          if (
            nextColumn < 0 ||
            nextRow < 0 ||
            nextColumn > columns ||
            nextRow > rows
          )
            continue;
          if (seen.has(key(nextColumn, nextRow))) continue;
          if (!walkable(nextColumn, nextRow)) continue;
          seen.add(key(nextColumn, nextRow));
          queue.push([nextColumn, nextRow]);
        }
      }

      const reached = new Set<string>();
      for (const cell of seen) {
        const column = cell % stride;
        const row = (cell - column) / stride;
        const x = originX + column * STEP;
        const z = originZ + row * STEP;
        for (const room of OFFICE_MAP.rooms.filter(
          (candidate) => (candidate.level ?? 0) === level,
        )) {
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

      const ilhadas = OFFICE_MAP.rooms
        .filter((room) => (room.level ?? 0) === level && !reached.has(room.id))
        .map((room) => room.id);
      expect(ilhadas).toEqual([]);
    }
  });

  it('liga os dutos nos dois sentidos', () => {
    for (const vent of OFFICE_MAP.vents) {
      for (const link of vent.links) {
        const other = OFFICE_MAP.vents.find(
          (candidate) => candidate.id === link,
        );
        expect(other?.links).toContain(vent.id);
      }
    }
  });

  it('mantém livres as duas entradas laterais do átrio', () => {
    for (const level of [0, 1]) {
      for (const point of [
        { x: 28, z: 29 },
        { x: 46, z: 29 },
      ]) {
        expect(resolveCollisions(point, collidersFor(level))).toEqual(point);
      }
    }
  });
});
