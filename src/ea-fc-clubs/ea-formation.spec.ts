import {
  completeFormation,
  rankPlayerPositions,
  selectBestFormation,
} from './ea-formation';

describe('selectBestFormation', () => {
  const positions = (defense: number, midfield: number, attack: number) => [
    ...Array<string>(defense).fill('DEFENDER'),
    ...Array<string>(midfield).fill('MIDFIELDER'),
    ...Array<string>(attack).fill('FORWARD'),
  ];

  it('selects the most used complete formation and breaks ties by results', () => {
    const result = selectBestFormation([
      {
        id: '352-win',
        playedAt: new Date('2026-09-03T23:37:00Z'),
        result: 'WIN',
        positions: positions(3, 5, 2),
      },
      {
        id: '352-draw',
        playedAt: new Date('2026-09-03T22:46:00Z'),
        result: 'DRAW',
        positions: positions(3, 5, 2),
      },
      {
        id: '433-loss-1',
        playedAt: new Date('2026-08-30T22:49:00Z'),
        result: 'LOSS',
        positions: positions(4, 3, 3),
      },
      {
        id: '433-loss-2',
        playedAt: new Date('2026-08-30T22:27:00Z'),
        result: 'LOSS',
        positions: positions(4, 3, 3),
      },
      {
        id: 'incomplete',
        playedAt: new Date('2026-09-03T23:00:00Z'),
        result: 'WIN',
        positions: positions(0, 2, 3),
      },
    ]);

    expect(result).toEqual({
      formation: '3-5-2',
      matches: 2,
      wins: 1,
      draws: 1,
      losses: 0,
      pointsPerMatch: 2,
    });
  });

  it('prioritizes frequency before the number of wins', () => {
    const result = selectBestFormation([
      {
        id: '433-loss-1',
        playedAt: new Date('2026-09-03T23:00:00Z'),
        result: 'LOSS',
        positions: positions(4, 3, 3),
      },
      {
        id: '433-loss-2',
        playedAt: new Date('2026-09-03T22:00:00Z'),
        result: 'LOSS',
        positions: positions(4, 3, 3),
      },
      {
        id: '433-loss-3',
        playedAt: new Date('2026-09-03T21:00:00Z'),
        result: 'LOSS',
        positions: positions(4, 3, 3),
      },
      {
        id: '352-win-1',
        playedAt: new Date('2026-09-03T20:00:00Z'),
        result: 'WIN',
        positions: positions(3, 5, 2),
      },
      {
        id: '352-win-2',
        playedAt: new Date('2026-09-03T19:00:00Z'),
        result: 'WIN',
        positions: positions(3, 5, 2),
      },
    ]);

    expect(result?.formation).toBe('4-3-3');
    expect(result?.matches).toBe(3);
  });
});

describe('completeFormation', () => {
  it('does not present an incomplete human lineup as a match formation', () => {
    expect(
      completeFormation([
        'FORWARD',
        'FORWARD',
        'FORWARD',
        'MIDFIELDER',
        'MIDFIELDER',
      ]),
    ).toBeNull();
  });
});

describe('rankPlayerPositions', () => {
  it('selects the position with the best per-match rating average', () => {
    const positions = rankPlayerPositions([
      {
        position: 'FORWARD',
        appearances: 6,
        ratingSum: 42,
        ratedMatches: 6,
        goals: 3,
        assists: 2,
        shots: 8,
        passesCompleted: 20,
        passesAttempted: 30,
        tacklesCompleted: 1,
        tacklesAttempted: 2,
        saves: 0,
      },
      {
        position: 'MIDFIELDER',
        appearances: 3,
        ratingSum: 24,
        ratedMatches: 3,
        goals: 1,
        assists: 3,
        shots: 2,
        passesCompleted: 30,
        passesAttempted: 36,
        tacklesCompleted: 4,
        tacklesAttempted: 6,
        saves: 0,
      },
    ]);

    expect(positions[0]).toEqual({
      position: 'MIDFIELDER',
      appearances: 3,
      averageRating: 8,
      goals: 1,
      assists: 3,
      shots: 2,
      shotConversion: 50,
      passesCompleted: 30,
      passAccuracy: 83.33333333333334,
      tacklesCompleted: 4,
      tackleAccuracy: 66.66666666666666,
      saves: 0,
    });
  });

  it('does not prioritize a one-match rating over a reliable sample', () => {
    const base = {
      goals: 0,
      assists: 0,
      shots: 0,
      passesCompleted: 0,
      passesAttempted: 0,
      tacklesCompleted: 0,
      tacklesAttempted: 0,
      saves: 0,
    };
    const positions = rankPlayerPositions([
      {
        position: 'FORWARD',
        appearances: 1,
        ratingSum: 10,
        ratedMatches: 1,
        ...base,
      },
      {
        position: 'MIDFIELDER',
        appearances: 6,
        ratingSum: 46.2,
        ratedMatches: 6,
        ...base,
      },
    ]);

    expect(positions[0]?.position).toBe('MIDFIELDER');
  });
});
