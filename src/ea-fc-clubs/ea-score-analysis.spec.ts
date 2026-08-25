import { analyzeEaMatchScore } from './ea-score-analysis';

const player = (SCORE: number, secondsPlayed: number, userResult = 0) => ({ SCORE, secondsPlayed, userResult });

describe('analyzeEaMatchScore', () => {
  it('accepts a complete score that agrees with the EA header', () => {
    const raw = { players: { home: { a: player(4, 5537), b: player(4, 5537) }, away: { c: player(2, 5537) } } };
    expect(analyzeEaMatchScore(raw, 'home', 'away', 4, 2)).toMatchObject({
      playerScore: { homeScore: 4, awayScore: 2 },
      interrupted: false,
      scoreMismatch: false,
    });
  });

  it('recovers a complete draw hidden by an administrative three nil', () => {
    const raw = { players: { home: { a: player(2, 5471, 6) }, away: { b: player(2, 5464, 6) } } };
    expect(analyzeEaMatchScore(raw, 'home', 'away', 3, 0)).toMatchObject({
      playerScore: { homeScore: 2, awayScore: 2 },
      interrupted: false,
      scoreMismatch: true,
      nonZeroUserResults: 2,
    });
  });

  it('rejects an administrative three nil created after an early interruption', () => {
    const raw = { players: { home: { a: player(0, 75, 6) }, away: { b: player(0, 86, 13) } } };
    expect(analyzeEaMatchScore(raw, 'home', 'away', 0, 3)).toMatchObject({
      playerScore: { homeScore: 0, awayScore: 0 },
      interrupted: true,
      shortAttempt: true,
      scoreMismatch: true,
    });
  });

  it('keeps a meaningful partial match for organization review', () => {
    const raw = { players: { home: { a: player(0, 1128, 6) }, away: { b: player(2, 1128, 12) } } };
    expect(analyzeEaMatchScore(raw, 'home', 'away', 0, 3)).toMatchObject({
      playerScore: { homeScore: 0, awayScore: 2 },
      interrupted: true,
      shortAttempt: false,
      scoreMismatch: true,
    });
  });

  it('uses the longest participant duration so a late entrant does not invalidate the match', () => {
    const raw = { players: { home: { late: player(3, 301), full: player(3, 5500) }, away: { full: player(2, 5500) } } };
    expect(analyzeEaMatchScore(raw, 'home', 'away', 3, 2).interrupted).toBe(false);
  });
});
