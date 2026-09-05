import {
  OFFICE_MAP,
  buildBathroomBarriers,
  buildObstacles,
  collidersFor,
  roomAt,
  sightBlockersFor,
  taskSpotById,
} from './map';
import { hasLineOfSight, moveTowards, resolveCollisions } from './movement';

const compact = (value: number) => 3 + (value - 3) * 0.74;
const point = (x: number, z: number) => ({ x: compact(x), z: compact(z) });
const pantryProps = OFFICE_MAP.props.filter(
  (prop) => roomAt(prop.x, prop.z, prop.level ?? 0)?.id === 'copa',
);

describe('apoio dos armários e do espelho na parede', () => {
  it.each([
    { kind: 'kitchen', room: 'copa', rearDepth: 0.32 },
    { kind: 'bathroomVanity', room: 'banheiro', rearDepth: 0.3125 },
  ])(
    'encosta $kind na face interna da parede sem afastar a bancada',
    ({ kind, room, rearDepth }) => {
      const prop = OFFICE_MAP.props.find((entry) => entry.kind === kind)!;
      const owner = OFFICE_MAP.rooms.find((entry) => entry.id === room)!;
      const wall = OFFICE_MAP.walls.find(
        (entry) =>
          (entry.level ?? 0) === 0 &&
          Math.abs(
            (entry.minX + entry.maxX) / 2 - owner.rect.x - owner.rect.w,
          ) < 1e-8 &&
          prop.z > entry.minZ &&
          prop.z < entry.maxZ,
      )!;
      expect(prop.x).toBeCloseTo(owner.rect.x + owner.rect.w - 0.504);
      expect(prop.rot).toBeCloseTo(-Math.PI / 2);
      // Profundidade traseira dos armários/espelho, não a borda maior da bancada.
      const mountGap = wall.minX - prop.x - rearDepth;
      expect(mountGap).toBeGreaterThanOrEqual(-0.025);
      expect(mountGap).toBeLessThanOrEqual(0.01);
      const [cabinet] = buildObstacles([prop]);
      expect(cabinet.maxX - wall.minX).toBeGreaterThan(0);
      expect(cabinet.maxX - wall.minX).toBeLessThan(0.06);
      const approach = { x: cabinet.minX - 0.5, z: prop.z };
      expect(resolveCollisions(approach, collidersFor(0))).toEqual(approach);
    },
  );
});

describe('copa com mesa de jantar e cafeteira de piso', () => {
  it('apoia a cafeteira no chão, separada da bancada e com tarefa na frente', () => {
    const coffee = pantryProps.find((prop) => prop.kind === 'coffee')!;
    const task = taskSpotById('cafe-a')!;
    expect(coffee).toMatchObject({ ...point(69.6, 29.5), rot: -Math.PI / 2 });
    expect(coffee.y ?? 0).toBe(0);
    const [bounds] = buildObstacles([coffee]);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(0.82);
    expect(bounds.maxZ - bounds.minZ).toBeCloseTo(0.85);
    expect(bounds).toMatchObject({ height: 1.95, tall: true, level: 0 });
    expect(resolveCollisions(coffee, collidersFor(0))).not.toEqual({
      x: coffee.x,
      z: coffee.z,
    });
    expect(sightBlockersFor(0)).toContainEqual(bounds);
    expect(task).toMatchObject({ room: 'copa' });
    expect(task.x).toBeCloseTo(coffee.x - 1.134);
    expect(task.z).toBeCloseTo(coffee.z);
    expect(coffee.x - task.x).toBeGreaterThan(0.86);
    expect(coffee.x - task.x).toBeLessThan(1.5);
    expect(resolveCollisions(task, collidersFor(0))).toEqual({
      x: task.x,
      z: task.z,
    });
  });

  it('usa uma mesa de 2.8 por 1.2 m e seis cadeiras de jantar alinhadas', () => {
    const tables = pantryProps.filter((prop) => prop.kind === 'diningTable');
    const chairs = pantryProps.filter((prop) => prop.kind === 'diningChair');
    expect(tables).toHaveLength(1);
    expect(chairs).toHaveLength(6);
    expect(
      pantryProps.some((prop) => ['chair', 'cafeTable'].includes(prop.kind)),
    ).toBe(false);
    const [table] = tables;
    const [bounds] = buildObstacles(tables);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(2.8);
    expect(bounds.maxZ - bounds.minZ).toBeCloseTo(1.2);
    expect(bounds.height).toBe(0.78);
    for (const offset of [-1.092, 1.092]) {
      const row = chairs.filter(
        (chair) => Math.abs(chair.z - table.z - offset) < 1e-8,
      );
      const xs = row.map((chair) => chair.x).sort((a, b) => a - b);
      expect(xs).toHaveLength(3);
      for (const [index, delta] of [-0.924, 0, 0.924].entries())
        expect(xs[index]).toBeCloseTo(table.x + delta);
      for (const chair of row) {
        const [chairBounds] = buildObstacles([chair]);
        expect(chairBounds.maxX - chairBounds.minX).toBeCloseTo(0.52);
        expect(chairBounds.maxZ - chairBounds.minZ).toBeCloseTo(0.56);
        expect(chairBounds.height).toBe(0.9);
        expect(Math.sin(chair.rot)).toBeCloseTo(0);
        expect(Math.cos(chair.rot) * (table.z - chair.z)).toBeGreaterThan(1);
      }
    }
  });

  it('não sobrepõe os móveis e permite circular ao redor do conjunto de jantar', () => {
    const boxes = buildObstacles(pantryProps);
    for (let index = 0; index < boxes.length; index += 1) {
      for (const other of boxes.slice(index + 1)) {
        const box = boxes[index];
        expect(
          box.maxX <= other.minX ||
            box.minX >= other.maxX ||
            box.maxZ <= other.minZ ||
            box.minZ >= other.maxZ,
        ).toBe(true);
      }
    }
    const route = [
      [58.5, 23],
      [65, 23],
      [65, 29],
      [58.5, 29],
      [58.5, 23],
    ].map(([x, z]) => point(x, z));
    for (let index = 1; index < route.length; index += 1) {
      const reached = moveTowards(
        route[index - 1],
        route[index],
        10,
        collidersFor(0),
      );
      expect(reached.x).toBeCloseTo(route[index].x, 6);
      expect(reached.z).toBeCloseTo(route[index].z, 6);
    }
  });
});

describe('banheiro privativo e corredor de serviço', () => {
  it('preserva a entrada do banheiro e fecha a antiga passagem ao depósito', () => {
    const bathroom = OFFICE_MAP.rooms.find((room) => room.id === 'banheiro')!;
    const storage = OFFICE_MAP.rooms.find((room) => room.id === 'deposito')!;
    const service = OFFICE_MAP.rooms.find(
      (room) => room.id === 'corredor-servico',
    )!;
    expect(service.rect).toEqual({
      ...point(47, 41),
      w: 8 * 0.74,
      d: 14 * 0.74,
    });
    expect(service).toMatchObject({ kind: 'corredor', finish: 'vinyl' });
    expect(service.doors.map((door) => door.side).sort()).toEqual([
      'east',
      'north',
    ]);
    expect(bathroom.doors).toHaveLength(1);
    expect(bathroom.doors[0]).toMatchObject({ side: 'west' });
    expect(
      bathroom.rect.z + bathroom.doors[0].at + bathroom.doors[0].width / 2,
    ).toBeCloseTo(compact(38));
    expect(storage.doors).toHaveLength(1);
    expect(storage.doors[0]).toMatchObject({ side: 'west' });
    expect(
      storage.rect.z + storage.doors[0].at + storage.doors[0].width / 2,
    ).toBeCloseTo(compact(50));
    const walls = OFFICE_MAP.walls.filter((wall) => (wall.level ?? 0) === 0);
    for (const [from, to] of [
      [point(63, 44), point(63, 46)],
      [point(63, 46), point(63, 44)],
    ]) {
      const reached = moveTowards(from, to, 3, walls);
      expect(Math.abs(reached.z - to.z)).toBeGreaterThan(1);
      expect(hasLineOfSight(from, to, walls)).toBe(false);
    }
  });

  it.each(['entrada', 'saída'] as const)(
    'alcança o inventário pela %s de serviço sem passar pelo banheiro',
    (direction) => {
      const route = [
        [51, 39],
        [51, 50],
        [56.5, 50],
        [56.5, 47],
        [64, 47],
      ].map(([x, z]) => point(x, z));
      const task = taskSpotById('estoque-b')!;
      route.push({ x: task.x, z: task.z });
      expect(route.at(-1)).toMatchObject({
        x: taskSpotById('estoque-b')!.x,
        z: taskSpotById('estoque-b')!.z,
      });
      if (direction === 'saída') route.reverse();
      let position = route[0];
      for (const target of route.slice(1)) {
        for (let step = 0; step < 250; step += 1) {
          if (Math.hypot(position.x - target.x, position.z - target.z) < 1e-6)
            break;
          position = moveTowards(position, target, 0.05, collidersFor(0));
          expect(roomAt(position.x, position.z)?.id).not.toBe('banheiro');
        }
        expect(position.x).toBeCloseTo(target.x, 6);
        expect(position.z).toBeCloseTo(target.z, 6);
      }
    },
  );

  it('mantém quatro divisórias sólidas e opacas com a mesma geometria das cabines', () => {
    const barriers = buildBathroomBarriers(OFFICE_MAP.rooms);
    expect(buildBathroomBarriers([])).toEqual([]);
    expect(barriers).toHaveLength(4);
    for (const [index, x] of [56.75, 60.35, 64].entries()) {
      expect(barriers[index].minX).toBeCloseTo(compact(x) - 0.0425);
      expect(barriers[index].maxX).toBeCloseTo(compact(x) + 0.0425);
      expect(barriers[index].minZ).toBeCloseTo(compact(40.5) - 0.045);
      expect(barriers[index].maxZ).toBeCloseTo(compact(45) - 0.15);
    }
    expect(barriers[3].minZ).toBeCloseTo(compact(40.5) - 0.0425);
    expect(barriers[3].maxZ).toBeCloseTo(compact(40.5) + 0.0425);
    for (const barrier of barriers) {
      expect(barrier).toMatchObject({ height: 2.32, tall: true, level: 0 });
      expect(OFFICE_MAP.obstacles).toContainEqual(barrier);
      expect(OFFICE_MAP.walls).not.toContainEqual(barrier);
      expect(sightBlockersFor(0)).toContainEqual(barrier);
      expect(collidersFor(1)).not.toContainEqual(barrier);
    }
    for (const feetHeight of [0, 1.2]) {
      for (const x of [58.55, 62.18]) {
        const from = point(x, 39.5);
        const to = point(x, 41.5);
        const reached = moveTowards(
          from,
          to,
          3,
          collidersFor(0, OFFICE_MAP, feetHeight),
        );
        expect(reached.z).toBeLessThan(compact(40.5) - 0.45);
        expect(hasLineOfSight(from, to, sightBlockersFor(0))).toBe(false);
      }
    }
    const hygiene = taskSpotById('higiene-banheiro')!;
    expect(hygiene.x).toBeCloseTo(compact(71) - 0.504 - 1.26);
    expect(hygiene.z).toBeCloseTo(compact(40.4));
    expect(resolveCollisions(hygiene, collidersFor(0))).toEqual({
      x: hygiene.x,
      z: hygiene.z,
    });
  });
});
