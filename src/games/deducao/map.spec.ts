import {
  OFFICE_MAP,
  buildBathroomBarriers,
  buildObstacles,
  buildStairBarriers,
  buildWalls,
  collidersFor,
  roomAt,
  stairProgressAt,
  taskSpotById,
  ventById,
  type Door,
  type RoomDef,
} from './map';
import { LOCAL_GAME_MAPS, PRIMARY_MAP_ID } from './maps';
import { moveTowards, resolveCollisions, type Vec2 } from './movement';

function doorway(room: RoomDef, door: Door) {
  const horizontal = door.side === 'north' || door.side === 'south';
  const outward = {
    x: door.side === 'east' ? 1 : door.side === 'west' ? -1 : 0,
    z: door.side === 'south' ? 1 : door.side === 'north' ? -1 : 0,
  };
  return {
    horizontal,
    outward,
    center: {
      x: horizontal
        ? room.rect.x + door.at + door.width / 2
        : room.rect.x + (door.side === 'east' ? room.rect.w : 0),
      z: horizontal
        ? room.rect.z + (door.side === 'south' ? room.rect.d : 0)
        : room.rect.z + door.at + door.width / 2,
    },
  };
}

describe('contrato do mapa do escritório', () => {
  it('publica somente o mapa original com a mesma geometria e sem variantes antigas', () => {
    expect(PRIMARY_MAP_ID).toBe('original');
    expect(LOCAL_GAME_MAPS).toEqual([{ id: PRIMARY_MAP_ID, map: OFFICE_MAP }]);
    expect(LOCAL_GAME_MAPS[0].map).toBe(OFFICE_MAP);
    expect(OFFICE_MAP.walls).toEqual(buildWalls(OFFICE_MAP.rooms));
    expect(OFFICE_MAP.obstacles).toEqual([
      ...buildObstacles(OFFICE_MAP.props),
      ...buildStairBarriers(OFFICE_MAP.stairs),
      ...buildBathroomBarriers(OFFICE_MAP.rooms),
    ]);
  });

  it('conserva identificadores, posições e colisões no JSON enviado ao cliente', () => {
    const payload = JSON.parse(JSON.stringify(OFFICE_MAP)) as typeof OFFICE_MAP;
    expect(payload).toEqual(OFFICE_MAP);
    for (const key of ['rooms', 'taskSpots', 'vents', 'stairs'] as const) {
      const ids = payload[key].map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(JSON.stringify(payload)).not.toMatch(/garagem|Recarregar o carro/);
    expect(taskSpotById('cabos-c', payload)).toBeUndefined();
    expect(ventById('vent-garagem', payload)).toBeUndefined();
    expect(ventById('vent-apoio', payload)?.room).toBe('apoio');
    for (const level of [0, 1]) {
      expect(collidersFor(level, payload)).toEqual(collidersFor(level));
    }
  });

  it('mantém todo duto conectado à rede após a troca da garagem', () => {
    const visited = new Set<string>();
    const pending = [OFFICE_MAP.vents[0].id];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const vent = ventById(id)!;
      expect(vent).toBeDefined();
      expect(vent.links).not.toContain(id);
      expect(new Set(vent.links).size).toBe(vent.links.length);
      for (const link of vent.links) {
        expect(ventById(link)?.links).toContain(id);
        pending.push(link);
      }
    }
    expect([...visited].sort()).toEqual(
      OFFICE_MAP.vents.map((vent) => vent.id).sort(),
    );
  });
});

describe('portas e paredes externas', () => {
  for (const room of OFFICE_MAP.rooms) {
    it(`atravessa todas as portas de ${room.name} nos dois sentidos`, () => {
      const blockers = collidersFor(room.level ?? 0);
      for (const door of room.doors) {
        const { center, outward, horizontal } = doorway(room, door);
        const span = horizontal ? room.rect.w : room.rect.d;
        expect(door.at).toBeGreaterThanOrEqual(0);
        expect(door.at + door.width).toBeLessThanOrEqual(span + 1e-9);
        for (const lateral of [-0.45, 0, 0.45]) {
          const at = {
            x: center.x + (horizontal ? lateral : 0),
            z: center.z + (horizontal ? 0 : lateral),
          };
          const inside = { x: at.x - outward.x, z: at.z - outward.z };
          const outside = { x: at.x + outward.x, z: at.z + outward.z };
          for (const [from, to] of [
            [inside, outside],
            [outside, inside],
          ]) {
            const reached = moveTowards(from, to, 2, blockers);
            expect(reached.x).toBeCloseTo(to.x, 6);
            expect(reached.z).toBeCloseTo(to.z, 6);
          }
        }
      }
    });
  }

  it.each([0, 1.2])(
    'janelas e guarda-corpos continuam barrando o corpo a %s m de altura',
    (feetHeight) => {
      let checked = 0;
      for (const room of OFFICE_MAP.rooms) {
        const level = room.level ?? 0;
        const blockers = collidersFor(level, OFFICE_MAP, feetHeight);
        for (const side of ['north', 'south', 'east', 'west'] as const) {
          const length =
            side === 'north' || side === 'south' ? room.rect.w : room.rect.d;
          for (let at = 1; at < length - 1; at += 1) {
            if (
              room.doors.some(
                (door) =>
                  door.side === side &&
                  at > door.at - 0.6 &&
                  at < door.at + door.width + 0.6,
              )
            )
              continue;
            const { center, outward } = doorway(room, { side, at, width: 0 });
            const inside = { x: center.x - outward.x, z: center.z - outward.z };
            const outside = {
              x: center.x + outward.x,
              z: center.z + outward.z,
            };
            if (roomAt(outside.x, outside.z, level)) continue;
            if (
              JSON.stringify(resolveCollisions(inside, blockers)) !==
              JSON.stringify(inside)
            )
              continue;
            const stopped = moveTowards(inside, outside, 2, blockers);
            const signedDistance =
              (stopped.x - center.x) * outward.x +
              (stopped.z - center.z) * outward.z;
            expect(signedDistance).toBeLessThanOrEqual(-0.45);
            checked += 1;
          }
        }
      }
      expect(checked).toBeGreaterThan(150);
    },
  );
});

describe('acesso às interações', () => {
  it('oferece dois ou três pontos e pelo menos dois minigames distintos em cada ambiente jogável', () => {
    expect(OFFICE_MAP.taskSpots).toHaveLength(55);
    for (const room of OFFICE_MAP.rooms) {
      const spots = OFFICE_MAP.taskSpots.filter((spot) => spot.room === room.id);
      expect({ room: room.id, enough: spots.length >= 2 && spots.length <= 3 }).toEqual({ room: room.id, enough: true });
      expect(new Set(spots.map((spot) => spot.kind)).size).toBeGreaterThanOrEqual(2);
      for (const spot of spots) {
        expect(roomAt(spot.x, spot.z, spot.level ?? 0)?.id).toBe(room.id);
        expect(stairProgressAt(spot.x, spot.z)).toBeNull();
      }
    }
    expect(new Set(OFFICE_MAP.taskSpots.map((spot) => spot.kind))).toEqual(new Set(['rack', 'arquivo', 'senha', 'cafe', 'cabos', 'impressora', 'estoque']));
    expect(['curta', 'media', 'longa'].map((duration) => OFFICE_MAP.taskSpots.filter((spot) => spot.duration === duration).length)).toEqual([21, 21, 13]);
  });

  it.each([0, 1])(
    'chega a todas as tarefas e dutos do piso %s por caminhos com colisão',
    (level) => {
      const blockers = collidersFor(level);
      const step = 0.5;
      const columns = Math.ceil(OFFICE_MAP.bounds.w / step);
      const rows = Math.ceil(OFFICE_MAP.bounds.d / step);
      const stride = columns + 1;
      const cellKey = (column: number, row: number) => row * stride + column;
      const positionAt = (column: number, row: number) => ({
        x: OFFICE_MAP.bounds.x + column * step,
        z: OFFICE_MAP.bounds.z + row * step,
      });
      const starts = [
        ...OFFICE_MAP.spawns.filter((spawn) => (spawn.level ?? 0) === level),
        ...OFFICE_MAP.stairs
          .filter((stair) => stair.targetLevel === level)
          .map((stair) => ({ x: stair.targetX, z: stair.targetZ })),
      ];
      const visited = new Set<number>();
      const pending: [number, number][] = [];
      for (const start of starts) {
        const column = Math.round((start.x - OFFICE_MAP.bounds.x) / step);
        const row = Math.round((start.z - OFFICE_MAP.bounds.z) / step);
        const cell = positionAt(column, row);
        const reached = moveTowards(start, cell, step, blockers);
        expect(reached.x).toBeCloseTo(cell.x, 6);
        expect(reached.z).toBeCloseTo(cell.z, 6);
        visited.add(cellKey(column, row));
        pending.push([column, row]);
      }
      while (pending.length) {
        const [column, row] = pending.pop()!;
        const from = positionAt(column, row);
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
          const key = cellKey(nextColumn, nextRow);
          if (visited.has(key)) continue;
          const target = positionAt(nextColumn, nextRow);
          const reached = moveTowards(from, target, step, blockers);
          if (Math.hypot(reached.x - target.x, reached.z - target.z) > 1e-9)
            continue;
          visited.add(key);
          pending.push([nextColumn, nextRow]);
        }
      }
      for (const point of [...OFFICE_MAP.taskSpots, ...OFFICE_MAP.vents].filter(
        (candidate) => (candidate.level ?? 0) === level,
      )) {
        const column = Math.round((point.x - OFFICE_MAP.bounds.x) / step);
        const row = Math.round((point.z - OFFICE_MAP.bounds.z) / step);
        let reachable = false;
        for (const dx of [-1, 0, 1]) {
          for (const dz of [-1, 0, 1]) {
            if (!visited.has(cellKey(column + dx, row + dz))) continue;
            const reached = moveTowards(
              positionAt(column + dx, row + dz),
              point,
              1.1,
              blockers,
            );
            reachable ||=
              Math.hypot(reached.x - point.x, reached.z - point.z) < 1e-9;
          }
        }
        expect({ id: point.id, reachable }).toEqual({
          id: point.id,
          reachable: true,
        });
      }
    },
  );
});

describe('escada com aproximações laterais', () => {
  it.each([0, 1])(
    'mantém plano todo ponto livre do patamar na camada %s',
    (level) => {
      const stair = OFFICE_MAP.stairs[0];
      const blockers = collidersFor(level);
      let checked = 0;
      for (let x = -12; x <= 12; x += 1) {
        for (let z = -12; z <= 12; z += 1) {
          const position = {
            x: stair.turnX! + x / 10,
            z: stair.turnZ! + z / 10,
          };
          const resolved = resolveCollisions(position, blockers);
          if (
            Math.hypot(resolved.x - position.x, resolved.z - position.z) > 1e-9
          )
            continue;
          expect(stairProgressAt(position.x, position.z)?.progress).toBeCloseTo(
            0.5,
            9,
          );
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(150);
    },
  );

  it.each([-0.55, 0, 0.55])(
    'sobe e desce inteira com deslocamento lateral de %s m',
    (offset) => {
      const stair = OFFICE_MAP.stairs[0];
      const path: Vec2[] = [
        { x: stair.x + offset, z: stair.z - 0.8 },
        { x: stair.x + offset, z: stair.z },
        { x: stair.turnX! + offset, z: stair.turnZ! - 0.7 },
        { x: stair.turnX! + offset, z: stair.turnZ! + offset },
        { x: stair.turnX! - 1.4, z: stair.turnZ! + offset },
        { x: stair.targetX, z: stair.targetZ + offset },
        { x: stair.targetX - 0.8, z: stair.targetZ + offset },
      ];
      for (const ascending of [true, false]) {
        const route = ascending ? path : [...path].reverse();
        let position = route[0];
        let level = ascending ? stair.level : stair.targetLevel;
        let previousProgress = ascending ? 0 : 1;
        const changes: number[] = [];
        for (const target of route.slice(1)) {
          for (let step = 0; step < 180; step += 1) {
            if (Math.hypot(position.x - target.x, position.z - target.z) < 1e-6)
              break;
            position = moveTowards(position, target, 0.04, collidersFor(level));
            const sample = stairProgressAt(position.x, position.z);
            if (!sample) continue;
            expect(Math.abs(sample.progress - previousProgress)).toBeLessThan(
              0.04,
            );
            expect(
              ascending
                ? sample.progress - previousProgress
                : previousProgress - sample.progress,
            ).toBeGreaterThanOrEqual(-1e-9);
            previousProgress = sample.progress;
            if (level === stair.level && sample.progress >= 0.52) {
              level = stair.targetLevel;
              changes.push(level);
            } else if (level === stair.targetLevel && sample.progress <= 0.48) {
              level = stair.level;
              changes.push(level);
            }
          }
          expect(position.x).toBeCloseTo(target.x, 6);
          expect(position.z).toBeCloseTo(target.z, 6);
        }
        expect(changes).toEqual([ascending ? stair.targetLevel : stair.level]);
        expect(stairProgressAt(position.x, position.z)).toBeNull();
      }
    },
  );

  it.each([0, 1])(
    'corrimãos e canto externo do patamar impedem saída lateral no piso %s',
    (level) => {
      const stair = OFFICE_MAP.stairs[0];
      const blockers = collidersFor(level, OFFICE_MAP, 1.2);
      const firstFlight = { x: stair.x, z: stair.z + 1 };
      for (const sign of [-1, 1]) {
        const stopped = moveTowards(
          firstFlight,
          { x: firstFlight.x + sign * 2, z: firstFlight.z },
          2,
          blockers,
        );
        expect(Math.abs(stopped.x - firstFlight.x)).toBeLessThanOrEqual(
          0.600001,
        );
      }
      const turn = { x: stair.turnX!, z: stair.turnZ! };
      for (const target of [
        { x: turn.x + 2, z: turn.z },
        { x: turn.x, z: turn.z + 2 },
        { x: turn.x + 2, z: turn.z + 2 },
      ]) {
        const stopped = moveTowards(turn, target, 3, blockers);
        expect(stairProgressAt(stopped.x, stopped.z)?.progress).toBeCloseTo(
          0.5,
        );
        expect(Math.abs(stopped.x - turn.x)).toBeLessThanOrEqual(0.600001);
        expect(Math.abs(stopped.z - turn.z)).toBeLessThanOrEqual(0.600001);
      }
      const innerCorner = moveTowards(
        turn,
        { x: turn.x - 2, z: turn.z - 2 },
        3,
        blockers,
      );
      expect(stairProgressAt(innerCorner.x, innerCorner.z)).not.toBeNull();
      expect(
        innerCorner.x >= turn.x - 0.600001 ||
          innerCorner.z >= turn.z - 0.600001,
      ).toBe(true);
    },
  );
});
