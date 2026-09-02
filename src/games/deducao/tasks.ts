import type { TaskSpot } from './map';

/// Distribuição e validação das tarefas. O minigame em si roda no navegador, mas
/// o servidor só aceita a conclusão de uma tarefa que é daquela pessoa, que
/// ainda não foi feita, que ela abriu de perto e que ficou aberta tempo
/// suficiente. Sem isso, bastaria mandar "terminei" doze vezes seguidas.

export const TASK_RANGE = 2.2;

/// Nem o mais rápido dos minigames fecha antes disso, então serve de piso.
export const MIN_TASK_MS = 1_200;

export interface AssignedTask {
  spotId: string;
  done: boolean;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/// Cada um recebe tarefas espalhadas por salas diferentes. Quatro tarefas na
/// mesma sala fariam a pessoa nunca cruzar com ninguém, e cruzar com os outros
/// é o que gera o álibi.
export function drawTasks(
  playerIds: string[],
  spots: TaskSpot[],
  perPlayer: number,
  random: () => number = Math.random,
): Map<string, AssignedTask[]> {
  const result = new Map<string, AssignedTask[]>();

  for (const playerId of playerIds) {
    const pool = shuffle(spots, random);
    const chosen: TaskSpot[] = [];
    const usedRooms = new Set<string>();

    for (const spot of pool) {
      if (chosen.length >= perPlayer) break;
      if (usedRooms.has(spot.room)) continue;
      chosen.push(spot);
      usedRooms.add(spot.room);
    }
    // Sala repetida só entra quando não sobrou variedade suficiente.
    for (const spot of pool) {
      if (chosen.length >= perPlayer) break;
      if (chosen.includes(spot)) continue;
      chosen.push(spot);
    }

    result.set(
      playerId,
      chosen.map((spot) => ({ spotId: spot.id, done: false })),
    );
  }
  return result;
}

export function totalTasks(assignments: Map<string, AssignedTask[]>, aliveOnly: Set<string>): number {
  let total = 0;
  for (const [playerId, tasks] of assignments) {
    if (!aliveOnly.has(playerId)) continue;
    total += tasks.length;
  }
  return total;
}

export function doneTasks(assignments: Map<string, AssignedTask[]>, aliveOnly: Set<string>): number {
  let done = 0;
  for (const [playerId, tasks] of assignments) {
    if (!aliveOnly.has(playerId)) continue;
    done += tasks.filter((task) => task.done).length;
  }
  return done;
}
