import {
  OFFICE_MAP,
  buildObstacles,
  collidersFor,
  roomAt,
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
    const middle = stairProgressAt(stair.turnX!, stair.turnZ!);

    expect(stairProgressAt(stair.x, stair.z)?.progress).toBeCloseTo(0);
    expect(middle?.progress).toBeCloseTo(0.5);
    expect(stairProgressAt(stair.targetX, stair.targetZ)?.progress).toBeCloseTo(
      1,
    );
    expect(
      stairProgressAt(stair.turnX!, stair.turnZ! - 0.5)?.progress,
    ).toBeCloseTo(0.5);
    expect(
      stairProgressAt(stair.turnX! - 0.5, stair.turnZ!)?.progress,
    ).toBeCloseTo(0.5);
  });

  it('não trata o corredor ao lado como degrau', () => {
    const stair = OFFICE_MAP.stairs.find(
      (candidate) => candidate.targetLevel > candidate.level,
    )!;
    expect(stairProgressAt(stair.x + 2, stair.z)).toBeNull();
  });

  it.each([
    [-0.55, -0.55],
    [-0.55, 0.55],
    [0.55, -0.55],
    [0.55, 0.55],
  ])('mantém o patamar plano no quadrante %s, %s', (dx, dz) => {
    const stair = OFFICE_MAP.stairs[0];
    const point = { x: stair.turnX! + dx, z: stair.turnZ! + dz };

    expect(resolveCollisions(point, collidersFor(stair.level))).toEqual(point);
    expect(resolveCollisions(point, collidersFor(stair.targetLevel))).toEqual(
      point,
    );
    expect(stairProgressAt(point.x, point.z)?.progress).toBeCloseTo(0.5);
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
  it('reduz os ambientes sem encolher os móveis', () => {
    const openSpace = OFFICE_MAP.rooms.find((room) => room.id === 'openspace')!;
    const meeting = OFFICE_MAP.rooms.find((room) => room.id === 'reuniao')!;

    expect(OFFICE_MAP.bounds.w).toBeCloseTo(56.32);
    expect(OFFICE_MAP.bounds.d).toBeCloseTo(44.48);
    expect(openSpace.rect.w).toBeCloseTo(20.72);
    expect(meeting.rect.d).toBeCloseTo(10.36);
    expect(roomAt(24, 18)?.id).toBe('hall-central');
  });

  it('substitui a garagem por apoio sem mudar a sala nem a porta', () => {
    const support = OFFICE_MAP.rooms.find((room) => room.id === 'apoio')!;
    const corridor = OFFICE_MAP.rooms.find(
      (room) => room.id === 'corredor-oeste',
    )!;

    expect(support).toMatchObject({ name: 'Sala de apoio', finish: 'vinyl' });
    expect(support.rect.x).toBeCloseTo(3);
    expect(support.rect.z).toBeCloseTo(26.68);
    expect(support.rect.w).toBeCloseTo(11.84);
    expect(support.rect.d).toBeCloseTo(14.8);
    expect(support.doors).toHaveLength(1);
    expect(support.doors[0].side).toBe('east');
    expect(support.doors[0].at).toBeCloseTo(1.036);
    expect(support.doors[0].width).toBeCloseTo(2.368);
    expect(corridor.rect.x).toBeCloseTo(support.rect.x + support.rect.w);
    expect(corridor.doors).toContainEqual({
      side: 'west',
      at: expect.closeTo(
        support.rect.z + support.doors[0].at - corridor.rect.z,
      ),
      width: support.doors[0].width,
    });
    expect(
      OFFICE_MAP.rooms.some((room) => /garagem/i.test(room.id + room.name)),
    ).toBe(false);
    expect(
      OFFICE_MAP.props.some((prop) =>
        ['car', 'sportCar', 'cone'].includes(prop.kind),
      ),
    ).toBe(false);
  });

  it('usa mobiliário de apoio com colisões reais e sem obstáculos dos carros', () => {
    const support = OFFICE_MAP.rooms.find((room) => room.id === 'apoio')!;
    const furniture = OFFICE_MAP.props.filter(
      (prop) => roomAt(prop.x, prop.z, prop.level ?? 0)?.id === support.id,
    );
    const obstacles = OFFICE_MAP.obstacles.filter(
      (box) =>
        roomAt(
          (box.minX + box.maxX) / 2,
          (box.minZ + box.maxZ) / 2,
          box.level ?? 0,
        )?.id === support.id,
    );

    expect(furniture.map((prop) => prop.kind).sort()).toEqual([
      'chair',
      'desk',
      'plant',
      'shelf',
      'shelf',
    ]);
    expect(obstacles).toEqual(buildObstacles(furniture));
    for (const obstacle of obstacles) {
      expect(obstacle.minX).toBeGreaterThan(support.rect.x + 0.2);
      expect(obstacle.maxX).toBeLessThan(support.rect.x + support.rect.w - 0.2);
      expect(obstacle.minZ).toBeGreaterThan(support.rect.z + 0.2);
      expect(obstacle.maxZ).toBeLessThan(support.rect.z + support.rect.d - 0.2);
      const center = {
        x: (obstacle.minX + obstacle.maxX) / 2,
        z: (obstacle.minZ + obstacle.maxZ) / 2,
      };
      expect(resolveCollisions(center, collidersFor(0))).not.toEqual(center);
      if (obstacle.tall) {
        expect(obstacle.maxZ).toBeLessThan(support.rect.z + 2);
      }
    }
  });

  it.each(['entrada', 'saída'] as const)(
    'percorre a sala de apoio e o duto na %s sem prender na mobília',
    (direction) => {
      const support = OFFICE_MAP.rooms.find((room) => room.id === 'apoio')!;
      const vent = OFFICE_MAP.vents.find(
        (candidate) => candidate.id === 'vent-apoio',
      )!;
      const desk = OFFICE_MAP.props.find(
        (prop) =>
          prop.kind === 'desk' &&
          roomAt(prop.x, prop.z, prop.level ?? 0)?.id === support.id,
      )!;
      const doorway = {
        x: support.rect.x + support.rect.w,
        z: support.rect.z + support.doors[0].at + support.doors[0].width / 2,
      };
      const route = [
        { x: doorway.x + 1, z: doorway.z },
        { x: doorway.x - 1, z: doorway.z },
        { x: desk.x + 1.6, z: doorway.z },
        { x: desk.x + 1.6, z: desk.z },
        { x: vent.x, z: desk.z },
        { x: vent.x, z: vent.z },
      ];
      if (direction === 'saída') route.reverse();
      let point = route[0];
      for (const target of route.slice(1)) {
        for (let step = 0; step < 200; step += 1) {
          if (Math.hypot(point.x - target.x, point.z - target.z) < 1e-6) break;
          const next = moveTowards(point, target, 0.05, collidersFor(0));
          expect(
            Math.hypot(next.x - point.x, next.z - point.z),
          ).toBeGreaterThan(0);
          point = next;
        }
        expect(point.x).toBeCloseTo(target.x, 6);
        expect(point.z).toBeCloseTo(target.z, 6);
      }
      expect(vent).toMatchObject({
        room: 'apoio',
        links: ['vent-servidores', 'vent-terraco'],
      });
    },
  );

  it('remove a tarefa do carro e mantém tarefas e dutos em salas válidas', () => {
    expect(
      OFFICE_MAP.taskSpots.some(
        (spot) =>
          spot.id === 'cabos-c' ||
          /garagem|carro/i.test(spot.room + spot.label),
      ),
    ).toBe(false);
    expect(OFFICE_MAP.taskSpots.some((spot) => spot.room === 'apoio')).toBe(
      false,
    );
    expect(
      OFFICE_MAP.vents.some(
        (vent) =>
          vent.id === 'vent-garagem' || vent.links.includes('vent-garagem'),
      ),
    ).toBe(false);
    for (const point of [...OFFICE_MAP.taskSpots, ...OFFICE_MAP.vents]) {
      expect(roomAt(point.x, point.z, point.level ?? 0)?.id).toBe(point.room);
    }
  });

  it('deixa o botão sobre a mesa de reunião e ao alcance', () => {
    const table = OFFICE_MAP.props.find(
      (prop) => prop.kind === 'meetingTable' && (prop.level ?? 0) === 0,
    )!;
    const button = OFFICE_MAP.emergency;
    const approach = { x: button.x, z: button.z + 2.4 };

    expect(Math.abs(button.x - table.x)).toBeLessThanOrEqual(6.65 / 2);
    expect(Math.abs(button.z - table.z)).toBeLessThanOrEqual(2.5 / 2);
    expect(button.y).toBeCloseTo(0.86);
    expect(resolveCollisions(approach, collidersFor(0))).toEqual(approach);
    expect(
      Math.hypot(button.x - approach.x, button.z - approach.z),
    ).toBeLessThanOrEqual(2.6);
  });

  it('mantém o banheiro equipado e a tarefa junto da bancada', () => {
    const bathroom = OFFICE_MAP.rooms.find((room) => room.id === 'banheiro');
    const vanity = OFFICE_MAP.props.find(
      (prop) => prop.kind === 'bathroomVanity',
    );
    const toilets = OFFICE_MAP.props.filter((prop) => prop.kind === 'toilet');
    const task = OFFICE_MAP.taskSpots.find(
      (spot) => spot.id === 'higiene-banheiro',
    );

    expect(bathroom).toMatchObject({ name: 'Banheiro', finish: 'bathroom' });
    expect(vanity).toBeDefined();
    expect(toilets).toHaveLength(2);
    expect(task).toMatchObject({ room: 'banheiro' });
    expect(Math.hypot(task!.x - vanity!.x, task!.z - vanity!.z)).toBeLessThan(
      1.5,
    );
  });

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
    expect(OFFICE_MAP.stairs).toHaveLength(1);
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
      expect(stair.turnX).toBeCloseTo(stair.x);
      expect(stair.turnZ).toBeCloseTo(stair.targetZ);

      const hall = OFFICE_MAP.rooms.find((room) => room.id === 'hall-central')!;
      expect(hall.rect.x + hall.rect.w - stair.x).toBeCloseTo(1.589);
      expect(hall.rect.z + hall.rect.d - stair.turnZ!).toBeCloseTo(1.589);
    }
  });

  it.each(['subida', 'descida'] as const)(
    'percorre a escada inteira na %s e sai no andar correto',
    (direction) => {
      const stair = OFFICE_MAP.stairs[0];
      const route = [
        { x: stair.x, z: stair.z - 0.8 },
        { x: stair.x, z: stair.z },
        { x: stair.turnX!, z: stair.turnZ! - 0.5 },
        { x: stair.turnX! + 0.5, z: stair.turnZ! + 0.5 },
        { x: stair.turnX! - 0.5, z: stair.turnZ! },
        { x: stair.targetX, z: stair.targetZ },
        { x: stair.targetX - 0.8, z: stair.targetZ },
      ];
      if (direction === 'descida') route.reverse();
      let point = route[0];
      let level = direction === 'subida' ? stair.level : stair.targetLevel;
      const visitedLevels = [level];

      for (const target of route.slice(1)) {
        for (let step = 0; step < 150; step += 1) {
          if (Math.hypot(point.x - target.x, point.z - target.z) < 1e-6) break;
          const next = moveTowards(point, target, 0.05, collidersFor(level));
          expect(
            Math.hypot(next.x - point.x, next.z - point.z),
          ).toBeGreaterThan(0);
          point = next;
          const crossing = stairProgressAt(point.x, point.z);
          if (crossing && level === stair.level && crossing.progress >= 0.52) {
            level = stair.targetLevel;
            visitedLevels.push(level);
          } else if (
            crossing &&
            level === stair.targetLevel &&
            crossing.progress <= 0.48
          ) {
            level = stair.level;
            visitedLevels.push(level);
          }
        }
        expect(point.x).toBeCloseTo(target.x, 6);
        expect(point.z).toBeCloseTo(target.z, 6);
      }

      expect(visitedLevels).toEqual(
        direction === 'subida'
          ? [stair.level, stair.targetLevel]
          : [stair.targetLevel, stair.level],
      );
      expect(stairProgressAt(point.x, point.z)).toBeNull();
    },
  );

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
      const hall = OFFICE_MAP.rooms.find(
        (room) => room.id === (level === 0 ? 'hall-central' : 'hall-superior'),
      )!;
      for (const point of [
        { x: hall.rect.x + 0.84, z: hall.rect.z + hall.rect.d / 2 },
        {
          x: hall.rect.x + hall.rect.w - 0.84,
          z: hall.rect.z + hall.rect.d / 2,
        },
      ]) {
        expect(resolveCollisions(point, collidersFor(level))).toEqual(point);
      }
    }
  });
});
