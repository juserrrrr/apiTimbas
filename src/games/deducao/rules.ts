/// As regras do Timbas Detetive como funções puras: sorteio de papéis, apuração
/// da votação e condição de vitória. Nada aqui conhece Colyseus nem banco, então
/// dá para testar a partida inteira sem subir servidor.

export type Role = 'assassino' | 'detetive' | 'funcionario';

export type Phase = 'lobby' | 'jogando' | 'reuniao' | 'votacao' | 'fim';

export type Winner = 'escritorio' | 'assassinos';

export interface PlayerSnapshot {
  id: string;
  role: Role;
  alive: boolean;
}

export interface MatchConfig {
  killers: number;
  withDetective: boolean;
  tasksPerPlayer: number;
  killCooldownMs: number;
  killRange: number;
  meetingSeconds: number;
  voteSeconds: number;
  revealRoleOnEject: boolean;
  emergencyPerPlayer: number;
  blackoutEverySeconds: number;
  blackoutSeconds: number;
}

export const DEFAULT_CONFIG: MatchConfig = {
  killers: 1,
  withDetective: true,
  tasksPerPlayer: 4,
  killCooldownMs: 25_000,
  killRange: 2.2,
  meetingSeconds: 45,
  voteSeconds: 30,
  revealRoleOnEject: true,
  emergencyPerPlayer: 1,
  blackoutEverySeconds: 150,
  blackoutSeconds: 25,
};

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;

/// Quantos assassinos cabem numa sala desse tamanho. Passar disso deixa a
/// partida sem graça: o escritório perde antes de alguém desconfiar de alguma
/// coisa.
export function maxKillersFor(playerCount: number): number {
  if (playerCount >= 10) return 3;
  if (playerCount >= 7) return 2;
  return 1;
}

export function sanitizeConfig(config: MatchConfig, playerCount: number): MatchConfig {
  return {
    ...config,
    killers: Math.min(Math.max(1, Math.round(config.killers)), maxKillersFor(playerCount)),
    tasksPerPlayer: Math.min(Math.max(2, Math.round(config.tasksPerPlayer)), 8),
    killCooldownMs: Math.min(Math.max(10_000, Math.round(config.killCooldownMs)), 60_000),
    killRange: Math.min(Math.max(1.4, config.killRange), 4),
    meetingSeconds: Math.min(Math.max(15, Math.round(config.meetingSeconds)), 120),
    voteSeconds: Math.min(Math.max(15, Math.round(config.voteSeconds)), 120),
    emergencyPerPlayer: Math.min(Math.max(0, Math.round(config.emergencyPerPlayer)), 3),
    blackoutEverySeconds: Math.min(Math.max(60, Math.round(config.blackoutEverySeconds)), 600),
    blackoutSeconds: Math.min(Math.max(10, Math.round(config.blackoutSeconds)), 60),
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function assignRoles(
  playerIds: string[],
  config: MatchConfig,
  random: () => number = Math.random,
): Map<string, Role> {
  const order = shuffle(playerIds, random);
  const killers = Math.min(config.killers, Math.max(1, Math.floor(playerIds.length / 3)));
  const roles = new Map<string, Role>();

  order.forEach((id, index) => {
    if (index < killers) return roles.set(id, 'assassino');
    if (index === killers && config.withDetective) return roles.set(id, 'detetive');
    return roles.set(id, 'funcionario');
  });
  return roles;
}

/// Quem levou mais voto. Empate não ejeta ninguém, e quem passou não vota é
/// contado como abstenção, igual ao clássico do gênero.
export function tallyVotes(votes: Map<string, string | null>): {
  ejected: string | null;
  tie: boolean;
  counts: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  for (const target of votes.values()) {
    if (!target) continue;
    counts[target] = (counts[target] ?? 0) + 1;
  }

  let best: string | null = null;
  let bestCount = 0;
  let tie = false;
  for (const [target, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = target;
      bestCount = count;
      tie = false;
    } else if (count === bestCount) {
      tie = true;
    }
  }
  return { ejected: tie || bestCount === 0 ? null : best, tie: tie && bestCount > 0, counts };
}

export function winnerFor(players: PlayerSnapshot[], tasksDone: number, tasksTotal: number): Winner | null {
  const alive = players.filter((player) => player.alive);
  const killers = alive.filter((player) => player.role === 'assassino').length;
  const others = alive.length - killers;

  if (killers === 0) return 'escritorio';
  if (tasksTotal > 0 && tasksDone >= tasksTotal) return 'escritorio';
  if (killers >= others) return 'assassinos';
  return null;
}

/// A leitura do detetive sai atrasada de propósito: informação limpa e na hora
/// mataria a discussão, que é o jogo inteiro.
export function detectiveReading(target: PlayerSnapshot): 'suspeito' | 'limpo' {
  return target.role === 'assassino' ? 'suspeito' : 'limpo';
}
