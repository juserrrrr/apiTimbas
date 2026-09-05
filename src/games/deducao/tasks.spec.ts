import { OFFICE_MAP, type TaskSpot } from './map';
import { doneTasks, drawTasks, totalTasks } from './tasks';

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function firstSeparation(first: TaskSpot[]) {
  let nearest = Infinity;
  for (let index = 0; index < first.length; index++) {
    for (const other of first.slice(index + 1)) {
      nearest = Math.min(
        nearest,
        Math.hypot(
          first[index].x - other.x,
          first[index].z - other.z,
          ((first[index].level ?? 0) - (other.level ?? 0)) * 8,
        ),
      );
    }
  }
  return nearest;
}

function previousDraw(
  playerIds: string[],
  perPlayer: number,
  random: () => number,
) {
  return playerIds.map(() => {
    const pool = [...OFFICE_MAP.taskSpots];
    for (let index = pool.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [pool[index], pool[other]] = [pool[other], pool[index]];
    }
    const chosen: TaskSpot[] = [];
    for (const spot of pool) {
      if (!chosen.some((previous) => previous.room === spot.room))
        chosen.push(spot);
      if (chosen.length === perPlayer) break;
    }
    return chosen;
  });
}

describe('drawTasks', () => {
  it('dá a todo mundo a quantidade pedida', () => {
    const tasks = drawTasks(['a', 'b', 'c'], OFFICE_MAP.taskSpots, 4);
    for (const list of tasks.values()) expect(list).toHaveLength(4);
  });

  it('espalha as tarefas por salas diferentes', () => {
    const tasks = drawTasks(['a'], OFFICE_MAP.taskSpots, 4).get('a')!;
    const rooms = tasks.map(
      (task) =>
        OFFICE_MAP.taskSpots.find((spot) => spot.id === task.spotId)!.room,
    );
    expect(new Set(rooms).size).toBe(4);
  });

  it('não repete o mesmo ponto para a mesma pessoa', () => {
    const tasks = drawTasks(['a'], OFFICE_MAP.taskSpots, 6).get('a')!;
    expect(new Set(tasks.map((task) => task.spotId)).size).toBe(6);
  });

  it('nasce tudo por fazer', () => {
    const tasks = drawTasks(['a'], OFFICE_MAP.taskSpots, 3).get('a')!;
    expect(tasks.every((task) => !task.done)).toBe(true);
  });

  it.each([4, 8, 12])(
    'separa destinos iniciais e reduz compartilhamento para %s jogadores em cem sorteios',
    (count) => {
      const ids = Array.from(
        { length: count },
        (_, index) => `player-${index}`,
      );
      let separation = 0;
      let oldSeparation = 0;
      let overlap = 0;
      let oldOverlap = 0;
      for (let seed = 1; seed <= 100; seed++) {
        const assignments = drawTasks(
          ids,
          OFFICE_MAP.taskSpots,
          4,
          seeded(seed),
        );
        const tasks = [...assignments.values()].map((list) =>
          list.map(
            (task) =>
              OFFICE_MAP.taskSpots.find((spot) => spot.id === task.spotId)!,
          ),
        );
        const previous = previousDraw(ids, 4, seeded(seed));
        expect(new Set(tasks.map((list) => list[0].room)).size).toBe(count);
        for (const list of tasks) {
          expect(new Set(list.map((spot) => spot.room)).size).toBe(4);
          expect(
            new Set(list.map((spot) => spot.kind)).size,
          ).toBeGreaterThanOrEqual(3);
          expect(
            new Set(list.map((spot) => spot.duration)).size,
          ).toBeGreaterThanOrEqual(2);
        }
        separation += firstSeparation(tasks.map((list) => list[0]));
        oldSeparation += firstSeparation(previous.map((list) => list[0]));
        overlap +=
          count * 4 - new Set(tasks.flat().map((spot) => spot.id)).size;
        oldOverlap +=
          count * 4 - new Set(previous.flat().map((spot) => spot.id)).size;
      }
      expect(separation).toBeGreaterThan(oldSeparation * 1.5);
      expect(overlap).toBeLessThan(oldOverlap * 0.25);
    },
  );

  it('mantém aleatoriedade reproduzível e não depende da posição do anfitrião na lista', () => {
    const ids = ['host', 'b', 'c', 'd'];
    const first = drawTasks(ids, OFFICE_MAP.taskSpots, 8, seeded(17));
    expect(drawTasks(ids, OFFICE_MAP.taskSpots, 8, seeded(17))).toEqual(first);
    expect(drawTasks(ids, OFFICE_MAP.taskSpots, 8, seeded(18))).not.toEqual(
      first,
    );
    for (const list of first.values())
      expect(new Set(list.map((task) => task.spotId)).size).toBe(8);
    const hostStarts = new Set(
      Array.from(
        { length: 100 },
        (_, index) =>
          drawTasks(ids, OFFICE_MAP.taskSpots, 4, seeded(index)).get('host')![0]
            .spotId,
      ),
    );
    expect(hostStarts.size).toBeGreaterThan(10);
  });

  it('tolera poucos pontos e salas sem duplicar uma tarefa individual nem mutar o catálogo', () => {
    const pool = OFFICE_MAP.taskSpots.slice(0, 3).map((spot) => ({ ...spot }));
    const original = JSON.stringify(pool);
    for (const tasks of drawTasks(['a', 'b'], pool, 8, seeded(2)).values()) {
      expect(tasks).toHaveLength(3);
      expect(new Set(tasks.map((task) => task.spotId)).size).toBe(3);
    }
    expect(JSON.stringify(pool)).toBe(original);
    expect(drawTasks(['a'], [], 4).get('a')).toEqual([]);
    expect(drawTasks([], pool, 4).size).toBe(0);
  });

  it('inclui o apoio sem restaurar a recarga do carro removida', () => {
    const tasks = drawTasks(
      ['a'],
      OFFICE_MAP.taskSpots,
      OFFICE_MAP.taskSpots.length,
      () => 0.5,
    ).get('a')!;

    expect(tasks).toHaveLength(OFFICE_MAP.taskSpots.length);
    expect(tasks.some((task) => task.spotId === 'cabos-c')).toBe(false);
    for (const task of tasks) {
      const spot = OFFICE_MAP.taskSpots.find(
        (candidate) => candidate.id === task.spotId,
      )!;
      expect(spot.room).not.toBe('garagem');
    }
    expect(tasks.some((task) => task.spotId === 'arquivo-apoio')).toBe(true);
  });
});

describe('contagem da barra', () => {
  it('soma só quem entra na conta', () => {
    const assignments = drawTasks(['a', 'b'], OFFICE_MAP.taskSpots, 3);
    assignments.get('a')![0].done = true;

    expect(totalTasks(assignments, new Set(['a', 'b']))).toBe(6);
    expect(doneTasks(assignments, new Set(['a', 'b']))).toBe(1);
    expect(totalTasks(assignments, new Set(['a']))).toBe(3);
  });
});
