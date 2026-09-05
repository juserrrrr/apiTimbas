import { OFFICE_MAP, buildObstacles, collidersFor, roomAt } from './map';
import { resolveCollisions } from './movement';

const compact = (value: number) => 3 + (value - 3) * 0.74;

const seatingGroups = [
  { room: 'recepcao', level: 0, sofa: [0, 2.436], table: [10.5, 27.6] },
  { room: 'hall-central', level: 0, sofa: [-2.52, 0], table: [37, 22.5] },
  { room: 'hall-central', level: 0, sofa: [2.52, 0], table: [37, 22.5] },
  { room: 'lounge', level: 1, sofa: [0, -2.184], table: [10.5, 31.6] },
  { room: 'hall-superior', level: 1, sofa: [0, 2.268], table: [31.2, 19.8] },
  { room: 'hall-superior', level: 1, sofa: [0, 2.184], table: [31.2, 35.4] },
  { room: 'chefe', level: 1, sofa: [-2.1, 0], table: [64.7, 13.5] },
  { room: 'chefe', level: 1, sofa: [2.1, 0], table: [64.7, 13.5] },
  { room: 'terraco', level: 1, sofa: [-2.52, 0], table: [66.5, 46] },
];

describe('grupos de estar do escritório', () => {
  it('mantém nove sofás em grupos com propósito, sem bloquear a circulação central', () => {
    const sofas = OFFICE_MAP.props.filter((prop) => prop.kind === 'sofa');
    expect(sofas).toHaveLength(seatingGroups.length);
    const counts = new Map<string, number>();
    for (const sofa of sofas) {
      const room = roomAt(sofa.x, sofa.z, sofa.level ?? 0)!;
      counts.set(room.id, (counts.get(room.id) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      recepcao: 1,
      'hall-central': 2,
      lounge: 1,
      'hall-superior': 2,
      chefe: 2,
      terraco: 1,
    });
    for (const level of [0, 1]) {
      for (let z = compact(26); z <= compact(33); z += 0.2) {
        const point = { x: compact(37), z };
        expect(resolveCollisions(point, collidersFor(level))).toEqual(point);
      }
    }
  });

  it.each(seatingGroups)(
    'orienta o sofá $sofa de $room para sua mesa com passagem diante do assento',
    ({ room, level, sofa: [x, z], table: [tableX, tableZ] }) => {
      const sofa = OFFICE_MAP.props.find(
        (prop) =>
          prop.kind === 'sofa' &&
          (prop.level ?? 0) === level &&
          Math.abs(prop.x - compact(tableX) - x) < 1e-8 &&
          Math.abs(prop.z - compact(tableZ) - z) < 1e-8,
      )!;
      const table = OFFICE_MAP.props.find(
        (prop) =>
          prop.kind === 'cafeTable' &&
          (prop.level ?? 0) === level &&
          Math.abs(prop.x - compact(tableX)) < 1e-8 &&
          Math.abs(prop.z - compact(tableZ)) < 1e-8,
      )!;
      expect(sofa).toBeDefined();
      expect(table).toBeDefined();
      expect(roomAt(sofa.x, sofa.z, level)?.id).toBe(room);
      expect(roomAt(table.x, table.z, level)?.id).toBe(room);

      // O GLB exportado gira o modelo cru em 180 graus: rot 0 olha para +Z.
      const front = { x: Math.sin(sofa.rot), z: Math.cos(sofa.rot) };
      const distance = Math.hypot(table.x - sofa.x, table.z - sofa.z);
      expect(
        ((table.x - sofa.x) * front.x + (table.z - sofa.z) * front.z) /
          distance,
      ).toBeCloseTo(1, 8);
      const [sofaBounds] = buildObstacles([sofa]);
      const [tableBounds] = buildObstacles([table]);
      const sofaDepth =
        (Math.abs(front.x) * (sofaBounds.maxX - sofaBounds.minX) +
          Math.abs(front.z) * (sofaBounds.maxZ - sofaBounds.minZ)) /
        2;
      const tableDepth =
        (Math.abs(front.x) * (tableBounds.maxX - tableBounds.minX) +
          Math.abs(front.z) * (tableBounds.maxZ - tableBounds.minZ)) /
        2;
      expect(distance - sofaDepth - tableDepth).toBeGreaterThan(0.9);

      const passage = (sofaDepth + distance - tableDepth) / 2;
      for (const lateral of [-0.4, 0, 0.4]) {
        const point = {
          x: sofa.x + front.x * passage - front.z * lateral,
          z: sofa.z + front.z * passage + front.x * lateral,
        };
        const resolved = resolveCollisions(point, collidersFor(level));
        expect(resolved.x).toBeCloseTo(point.x, 6);
        expect(resolved.z).toBeCloseTo(point.z, 6);
      }
    },
  );

  it.each([
    {
      room: 'lounge',
      sofa: [10.5, 31.6 - 2.184 / 0.74],
      tv: [10.5, 34.77],
      side: 'south',
    },
    {
      room: 'hall-superior',
      sofa: [31.2, 19.8 + 2.268 / 0.74],
      tv: [31.2, 17.23],
      side: 'north',
    },
  ])(
    'deixa o sofá de $room olhando para a TV numa parede interna sem porta',
    ({ room: id, sofa: [x, z], tv: [tvX, tvZ], side }) => {
      const room = OFFICE_MAP.rooms.find((entry) => entry.id === id)!;
      const sofa = OFFICE_MAP.props.find(
        (prop) =>
          prop.kind === 'sofa' &&
          prop.level === 1 &&
          Math.abs(prop.x - compact(x)) < 1e-8 &&
          Math.abs(prop.z - compact(z)) < 1e-8,
      )!;
      const direction = {
        x: compact(tvX) - sofa.x,
        z: compact(tvZ) - sofa.z,
      };
      const distance = Math.hypot(direction.x, direction.z);
      expect(distance).toBeGreaterThan(3.5);
      expect(distance).toBeLessThan(5);
      expect(
        (direction.x * Math.sin(sofa.rot) + direction.z * Math.cos(sofa.rot)) /
          distance,
      ).toBeCloseTo(1, 8);
      const tvLeft = compact(tvX) - room.rect.x - 1.7;
      const tvRight = tvLeft + 3.4;
      expect(tvLeft).toBeGreaterThan(0);
      expect(tvRight).toBeLessThan(room.rect.w);
      for (const door of room.doors.filter((entry) => entry.side === side)) {
        expect(tvRight < door.at || tvLeft > door.at + door.width).toBe(true);
      }
    },
  );
});
