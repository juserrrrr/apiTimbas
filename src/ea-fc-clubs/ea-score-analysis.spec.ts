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

  it('sends an administrative three nil created before seven minutes to review', () => {
    const raw = { players: { home: { a: player(0, 75, 6) }, away: { b: player(0, 86, 13) } } };
    expect(analyzeEaMatchScore(raw, 'home', 'away', 0, 3)).toMatchObject({
      playerScore: { homeScore: 0, awayScore: 0 },
      interrupted: true,
      shortAttempt: true,
      scoreMismatch: true,
    });
  });

  it('only considers a match complete after 89 minutes', () => {
    expect(analyzeEaMatchScore(
      { players: { home: { a: player(1, 5339) }, away: { b: player(0, 5339) } } },
      'home',
      'away',
      1,
      0,
    ).interrupted).toBe(true);
    expect(analyzeEaMatchScore(
      { players: { home: { a: player(1, 5340) }, away: { b: player(0, 5340) } } },
      'home',
      'away',
      1,
      0,
    ).interrupted).toBe(false);
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
