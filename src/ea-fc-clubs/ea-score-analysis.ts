export const MIN_COMPLETED_EA_MATCH_SECONDS = 4500;

export interface EaScoreAnalysis {
  playerScore: { homeScore: number; awayScore: number } | null;
  homeDurationSeconds: number;
  awayDurationSeconds: number;
  interrupted: boolean;
  scoreMismatch: boolean;
  nonZeroUserResults: number;
  playerCount: number;
}

export function analyzeEaMatchScore(
  raw: unknown,
  homeClubId: string,
  awayClubId: string,
  officialHomeScore: number,
  officialAwayScore: number,
): EaScoreAnalysis {
  const players = objectValue(objectValue(raw)?.players);
  const home = analyzeClubPlayers(objectValue(players?.[homeClubId]));
  const away = analyzeClubPlayers(objectValue(players?.[awayClubId]));
  const playerScore = home.score === null || away.score === null
    ? null
    : { homeScore: home.score, awayScore: away.score };
  const interrupted = home.durationSeconds < MIN_COMPLETED_EA_MATCH_SECONDS ||
    away.durationSeconds < MIN_COMPLETED_EA_MATCH_SECONDS;

  return {
    playerScore,
    homeDurationSeconds: home.durationSeconds,
    awayDurationSeconds: away.durationSeconds,
    interrupted,
    scoreMismatch: Boolean(playerScore &&
      (playerScore.homeScore !== officialHomeScore || playerScore.awayScore !== officialAwayScore)),
    nonZeroUserResults: home.nonZeroUserResults + away.nonZeroUserResults,
    playerCount: home.playerCount + away.playerCount,
  };
}

function analyzeClubPlayers(players: Record<string, unknown> | null) {
  const scores: number[] = [];
  let durationSeconds = 0;
  let nonZeroUserResults = 0;
  let playerCount = 0;

  for (const rawPlayer of Object.values(players ?? {})) {
    const player = objectValue(rawPlayer);
    if (!player) continue;
    playerCount += 1;
    const score = nonNegativeInteger(player.SCORE);
    if (score !== null) scores.push(score);
    durationSeconds = Math.max(
      durationSeconds,
      nonNegativeNumber(player.secondsPlayed) ?? 0,
      nonNegativeNumber(player.gameTime) ?? 0,
    );
    if ((nonNegativeInteger(player.userResult) ?? 0) !== 0) nonZeroUserResults += 1;
  }

  return { score: mode(scores), durationSeconds, nonZeroUserResults, playerCount };
}

function mode(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return null;
  return sorted[0][0];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
