/**
 * Port of commands/utilsPerson/helpers.py – team drawing logic
 */
import * as fs from 'fs';
import * as path from 'path';

export interface PositionedPlayer {
  user: any; // GuildMember or User
  position: string;
}

const POSITIONS = ['Top', 'Jungle', 'Mid', 'ADC', 'Suporte'];
const POSITION_ORDER: Record<string, number> = { Top: 0, Jungle: 1, Mid: 2, ADC: 3, Suporte: 4 };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function drawTeams<T>(players: T[]): [T[], T[]] {
  const shuffled = shuffle(players);
  const half = Math.floor(shuffled.length / 2);
  return [shuffled.slice(0, half), shuffled.slice(half)];
}

export function drawPositions(): string[] {
  return shuffle([...POSITIONS]);
}

export function drawTeamsWithPositions<T>(players: T[]): [PositionedPlayer[], PositionedPlayer[]] {
  const shuffled = shuffle(players);
  const half = Math.floor(shuffled.length / 2);
  const bluePlayers = shuffled.slice(0, half);
  const redPlayers = shuffled.slice(half);

  const bluePositions = drawPositions();
  const redPositions = drawPositions();

  const makeTeam = (pl: T[], positions: string[]): PositionedPlayer[] => {
    const team = pl.map((user, i) => ({ user, position: positions[i] ?? 'Fill' }));
    return team.sort((a, b) => (POSITION_ORDER[a.position] ?? 999) - (POSITION_ORDER[b.position] ?? 999));
  };

  return [makeTeam(bluePlayers, bluePositions), makeTeam(redPlayers, redPositions)];
}

let championsCache: Record<string, string[]> | null = null;

function loadChampions(): Record<string, string[]> {
  if (championsCache) return championsCache;
  try {
    const filePath = path.join(__dirname, '..', 'data', 'champions_by_role.json');
    championsCache = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    championsCache = { Top: [], Jungle: [], Mid: [], ADC: [], Suporte: [] };
  }
  return championsCache!;
}

export function drawChampionForPosition(position: string, usedChampions: Set<string>): string {
  const champions = loadChampions();
  let available = (champions[position] ?? []).filter((c) => !usedChampions.has(c));

  if (!available.length) {
    const all = Object.values(champions).flat();
    available = all.filter((c) => !usedChampions.has(c));
  }

  if (!available.length) return 'Random';
  return available[Math.floor(Math.random() * available.length)];
}

export function getRandomChampions(n = 10): string[] {
  const champions = loadChampions();
  const all = Object.values(champions).flat();
  const shuffled = shuffle(all);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

export function extractUserFromTeamEntry(entry: any): any {
  return typeof entry === 'object' && 'user' in entry ? entry.user : entry;
}
