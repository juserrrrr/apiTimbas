import type { TaskDuration, TaskSpot } from './map';

/// Distribuição e validação das tarefas. O minigame em si roda no navegador, mas
/// o servidor só aceita a conclusão de uma tarefa que é daquela pessoa, que
/// ainda não foi feita, que ela abriu de perto e que ficou aberta tempo
/// suficiente. Sem isso, bastaria mandar "terminei" doze vezes seguidas.

export const TASK_RANGE = 2.2;

/// Nem o mais rápido dos minigames fecha antes disso, então serve de piso.
export const MIN_TASK_MS = 1_200;

const TASK_MINIMUM_MS: Record<TaskDuration, number> = {
  curta: MIN_TASK_MS,
  media: 3_500,
  longa: 6_500,
};

export function minTaskDurationMs(spot: Pick<TaskSpot, 'duration'>): number {
  return TASK_MINIMUM_MS[spot.duration ?? 'curta'];
}

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

/// A ordem sugere destinos, mas nunca limita qual tarefa pode ser aberta.
export function drawTasks(
  playerIds: string[],
  spots: TaskSpot[],
  perPlayer: number,
  random: () => number = Math.random,
): Map<string, AssignedTask[]> {
  const chosen = new Map(playerIds.map((id) => [id, [] as TaskSpot[]]));
  const spotUse = new Map<string, number>();
  const roomUse = new Map<string, number>();
  for (let round = 0; round < Math.min(perPlayer, spots.length); round++) {
    const destinations: TaskSpot[] = [];
    for (const playerId of shuffle(playerIds, random)) {
      const assigned = chosen.get(playerId)!;
      let best: TaskSpot | undefined;
      let bestScore: number[] = [];
      for (const spot of shuffle(spots, random)) {
        if (assigned.some((task) => task.id === spot.id)) continue;
        const neighbors = [...destinations, ...assigned];
        // A diferença de piso participa da dispersão; não estima uma rota de navegação.
        const separation = neighbors.length
          ? Math.min(
              ...neighbors.map((other) =>
                Math.hypot(
                  spot.x - other.x,
                  spot.z - other.z,
                  ((spot.level ?? 0) - (other.level ?? 0)) * 8,
                ),
              ),
            )
          : 0;
        const score = [
          Number(assigned.some((task) => task.room === spot.room)),
          spotUse.get(spot.id) ?? 0,
          roomUse.get(spot.room) ?? 0,
          Number(assigned.some((task) => task.kind === spot.kind)),
          Number(
            assigned.some(
              (task) =>
                (task.duration ?? 'curta') === (spot.duration ?? 'curta'),
            ),
          ),
          -separation,
        ];
        const difference = score.findIndex(
          (value, index) => value !== bestScore[index],
        );
        if (
          !best ||
          (difference >= 0 && score[difference] < bestScore[difference])
        ) {
          best = spot;
          bestScore = score;
        }
      }
      if (!best) continue;
      assigned.push(best);
      destinations.push(best);
      spotUse.set(best.id, (spotUse.get(best.id) ?? 0) + 1);
      roomUse.set(best.room, (roomUse.get(best.room) ?? 0) + 1);
    }
  }
  return new Map(
    [...chosen].map(([id, tasks]) => [
      id,
      tasks.map((spot) => ({ spotId: spot.id, done: false })),
    ]),
  );
}

export function totalTasks(
  assignments: Map<string, AssignedTask[]>,
  aliveOnly: Set<string>,
): number {
  let total = 0;
  for (const [playerId, tasks] of assignments) {
    if (!aliveOnly.has(playerId)) continue;
    total += tasks.length;
  }
  return total;
}

export function doneTasks(
  assignments: Map<string, AssignedTask[]>,
  aliveOnly: Set<string>,
): number {
  let done = 0;
  for (const [playerId, tasks] of assignments) {
    if (!aliveOnly.has(playerId)) continue;
    done += tasks.filter((task) => task.done).length;
  }
  return done;
}
