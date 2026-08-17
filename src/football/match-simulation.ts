import { TacticIntensity, TacticMentality } from '@prisma/client';
import { ATTRIBUTE_KEYS, AttributeKey } from './attributes';

export interface SimPlayer {
  id: string;
  position: string;
  overall: number;
  pace: number | null;
  shooting: number | null;
  passing: number | null;
  dribbling: number | null;
  defending: number | null;
  physical: number | null;
  form: number;
}

export interface SimSide {
  players: SimPlayer[];
  mentality: TacticMentality;
  pressing: TacticIntensity;
  tempo: TacticIntensity;
}

export interface PlayerPerformance {
  playerId: string;
  rating: number;
  goals: number;
  assists: number;
}

export interface SimulatedMatch {
  homeScore: number;
  awayScore: number;
  homePossession: number;
  performances: PlayerPerformance[];
  summary: string;
}

const LINES = {
  GK: ['GOL'],
  DEF: ['ZAG', 'LD', 'LE'],
  MID: ['VOL', 'MC', 'MEI'],
  ATT: ['PD', 'PE', 'ATA'],
} as const;

type Line = keyof typeof LINES;

/// Quanto cada atributo pesa na função da linha. Goleiro usa as mesmas colunas
/// com o significado de goleiro, então para ele tudo conta parecido.
const LINE_WEIGHTS: Record<Line, Partial<Record<AttributeKey, number>>> = {
  GK: { defending: 0.3, dribbling: 0.3, physical: 0.2, shooting: 0.2 },
  DEF: { defending: 0.5, physical: 0.25, pace: 0.25 },
  MID: { passing: 0.4, dribbling: 0.3, physical: 0.3 },
  ATT: { shooting: 0.45, pace: 0.3, dribbling: 0.25 },
};

const BASE_GOALS = 1.35;
const HOME_ATTACK = 1.05;
const HOME_DEFENSE = 1.03;
const EMPTY_LINE_PENALTY = 0.82;

export function lineOf(position: string): Line {
  const upper = position.toUpperCase();
  for (const [line, positions] of Object.entries(LINES)) {
    if ((positions as readonly string[]).includes(upper)) return line as Line;
  }
  return 'MID';
}

/// Nota do jogador dentro da função da linha, já com a forma somada. Sem
/// atributos o overall responde por tudo, então uma base sem estimativa ainda
/// joga, só com menos nuance.
export function playerStrength(player: SimPlayer, line: Line): number {
  const weights = LINE_WEIGHTS[line];
  let total = 0;
  let used = 0;

  for (const key of ATTRIBUTE_KEYS) {
    const weight = weights[key];
    const value = player[key];
    if (!weight || value === null) continue;
    total += value * weight;
    used += weight;
  }

  const base = used > 0 ? total / used : player.overall;
  return clamp(base + player.form * 1.2, 1, 99);
}

/// Escalação de emergência para quem não escalou: o melhor goleiro, depois a
/// melhor defesa, meio e ataque que o elenco permitir, e o resto por overall.
export function autoLineup(players: SimPlayer[], size: number): SimPlayer[] {
  const byStrength = [...players].sort((first, second) => second.overall - first.overall);
  const chosen: SimPlayer[] = [];
  const taken = new Set<string>();

  const take = (line: Line, howMany: number) => {
    for (const player of byStrength) {
      if (chosen.length >= size || howMany <= 0) return;
      if (taken.has(player.id) || lineOf(player.position) !== line) continue;
      chosen.push(player);
      taken.add(player.id);
      howMany--;
    }
  };

  take('GK', 1);
  take('DEF', 4);
  take('MID', 3);
  take('ATT', 3);

  for (const player of byStrength) {
    if (chosen.length >= size) break;
    if (taken.has(player.id)) continue;
    chosen.push(player);
    taken.add(player.id);
  }

  return chosen.slice(0, size);
}

export function simulateMatch(home: SimSide, away: SimSide, seed: string): SimulatedMatch {
  const random = mulberry32(hashSeed(seed));

  const homeUnits = units(home);
  const awayUnits = units(away);

  const homeAttack = homeUnits.attack * HOME_ATTACK;
  const homeDefense = homeUnits.defense * HOME_DEFENSE;
  const possession = homeUnits.midfield / (homeUnits.midfield + awayUnits.midfield);
  const pace = tempoFactor(home.tempo) * tempoFactor(away.tempo);

  const homeGoals = drawGoals(random, expectedGoals(homeAttack, awayUnits.defense, possession, pace));
  const awayGoals = drawGoals(random, expectedGoals(awayUnits.attack, homeDefense, 1 - possession, pace));

  const performances = [
    ...ratePlayers(random, home, homeUnits, awayUnits, homeGoals, awayGoals),
    ...ratePlayers(random, away, awayUnits, homeUnits, awayGoals, homeGoals),
  ];

  const homePossession = Math.round(possession * 100);
  return {
    homeScore: homeGoals,
    awayScore: awayGoals,
    homePossession,
    performances,
    summary: `Posse ${homePossession}% a ${100 - homePossession}%, ${homeGoals + awayGoals} gol(s) no jogo.`,
  };
}

interface Units {
  attack: number;
  midfield: number;
  defense: number;
}

function units(side: SimSide): Units {
  const attack = lineAverage(side.players, 'ATT') * 0.8 + lineAverage(side.players, 'MID') * 0.2;
  const midfield = lineAverage(side.players, 'MID') * 0.7 + lineAverage(side.players, 'DEF') * 0.15 + lineAverage(side.players, 'ATT') * 0.15;
  const defense = lineAverage(side.players, 'DEF') * 0.65 + lineAverage(side.players, 'GK') * 0.35;

  const mentality = mentalityFactor(side.mentality);
  const pressing = pressingFactor(side.pressing);

  return {
    attack: attack * mentality.attack,
    midfield: midfield * pressing.midfield,
    defense: defense * mentality.defense * pressing.defense,
  };
}

function lineAverage(players: SimPlayer[], line: Line): number {
  const inLine = players.filter((player) => lineOf(player.position) === line);
  if (inLine.length === 0) {
    // Escalação sem essa função não zera o time, ela só fica pior do que a média.
    const squad = players.length > 0 ? players.reduce((sum, player) => sum + player.overall, 0) / players.length : 50;
    return squad * EMPTY_LINE_PENALTY;
  }
  return inLine.reduce((sum, player) => sum + playerStrength(player, line), 0) / inLine.length;
}

function mentalityFactor(mentality: TacticMentality): { attack: number; defense: number } {
  if (mentality === TacticMentality.ATTACKING) return { attack: 1.08, defense: 0.92 };
  if (mentality === TacticMentality.DEFENSIVE) return { attack: 0.9, defense: 1.1 };
  return { attack: 1, defense: 1 };
}

/// Marcar alto ganha o meio e entrega as costas da defesa.
function pressingFactor(pressing: TacticIntensity): { midfield: number; defense: number } {
  if (pressing === TacticIntensity.HIGH) return { midfield: 1.06, defense: 0.96 };
  if (pressing === TacticIntensity.LOW) return { midfield: 0.95, defense: 1.04 };
  return { midfield: 1, defense: 1 };
}

function tempoFactor(tempo: TacticIntensity): number {
  if (tempo === TacticIntensity.HIGH) return 1.08;
  if (tempo === TacticIntensity.LOW) return 0.94;
  return 1;
}

function expectedGoals(attack: number, defense: number, possession: number, pace: number): number {
  const balance = (attack / Math.max(defense, 1)) ** 1.7;
  return clamp(BASE_GOALS * balance * (0.7 + 0.6 * possession) * pace, 0.15, 6);
}

/// Poisson pelo método de Knuth: número de gols com a média esperada.
function drawGoals(random: () => number, lambda: number): number {
  const limit = Math.exp(-lambda);
  let goals = 0;
  let product = random();
  while (product > limit && goals < 9) {
    goals++;
    product *= random();
  }
  return goals;
}

function ratePlayers(
  random: () => number,
  side: SimSide,
  own: Units,
  opponent: Units,
  scored: number,
  conceded: number,
): PlayerPerformance[] {
  const scorers = distribute(random, scored, side.players, (player) => scoringWeight(player));
  const assisters = distribute(random, Math.round(scored * 0.65), side.players, (player) => assistWeight(player));

  const result = scored > conceded ? 0.6 : scored === conceded ? 0 : -0.5;
  const attackEdge = clamp((own.attack - opponent.defense) / 20, -0.5, 0.5);
  const defenseEdge = clamp((own.defense - opponent.attack) / 20, -0.5, 0.5);

  return side.players.map((player) => {
    const line = lineOf(player.position);
    const goals = scorers.get(player.id) ?? 0;
    const assists = assisters.get(player.id) ?? 0;
    const defensive = line === 'GK' || line === 'DEF';

    let rating = 6;
    rating += goals * 0.9 + assists * 0.5;
    rating += result;
    rating += defensive ? defenseEdge : attackEdge;
    if (defensive) rating += conceded === 0 ? 0.5 : conceded >= 3 ? -0.6 : 0;
    rating += player.form * 0.08;
    rating += (random() - 0.5) * 1.2;

    return {
      playerId: player.id,
      rating: Math.round(clamp(rating, 3, 10) * 10) / 10,
      goals,
      assists,
    };
  });
}

function scoringWeight(player: SimPlayer): number {
  const line = lineOf(player.position);
  if (line === 'GK') return 0;
  const finishing = player.shooting ?? player.overall;
  if (line === 'ATT') return finishing * 3;
  if (line === 'MID') return finishing;
  return finishing * 0.3;
}

function assistWeight(player: SimPlayer): number {
  const line = lineOf(player.position);
  if (line === 'GK') return 0;
  const vision = player.passing ?? player.overall;
  if (line === 'MID') return vision * 2.5;
  if (line === 'ATT') return vision * 1.5;
  return vision * 0.6;
}

/// Sorteia `count` eventos entre os jogadores, com peso, sem travar quando todos
/// os pesos são zero.
function distribute(
  random: () => number,
  count: number,
  players: SimPlayer[],
  weightOf: (player: SimPlayer) => number,
): Map<string, number> {
  const tally = new Map<string, number>();
  const weights = players.map(weightOf);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (count <= 0 || total <= 0) return tally;

  for (let event = 0; event < count; event++) {
    let target = random() * total;
    for (const [index, player] of players.entries()) {
      target -= weights[index];
      if (target <= 0) {
        tally.set(player.id, (tally.get(player.id) ?? 0) + 1);
        break;
      }
    }
  }
  return tally;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/// Gerador com semente: a mesma partida sempre dá o mesmo resultado, o que deixa
/// o job idempotente e o teste possível.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
