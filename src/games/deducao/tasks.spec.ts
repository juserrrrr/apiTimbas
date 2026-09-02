import { OFFICE_MAP } from './map';
import { doneTasks, drawTasks, totalTasks } from './tasks';

describe('drawTasks', () => {
  it('dá a todo mundo a quantidade pedida', () => {
    const tasks = drawTasks(['a', 'b', 'c'], OFFICE_MAP.taskSpots, 4);
    for (const list of tasks.values()) expect(list).toHaveLength(4);
  });

  it('espalha as tarefas por salas diferentes', () => {
    const tasks = drawTasks(['a'], OFFICE_MAP.taskSpots, 4).get('a')!;
    const rooms = tasks.map((task) => OFFICE_MAP.taskSpots.find((spot) => spot.id === task.spotId)!.room);
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
