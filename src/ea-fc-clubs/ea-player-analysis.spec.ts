import { analyseRecentPlayerMatches } from './ea-player-analysis';

const match = (overrides = {}) => ({
  position: 'ST',
  rating: 7,
  goals: 0,
  assists: 0,
  shots: 0,
  passesAttempted: 0,
  passesCompleted: 0,
  tacklesAttempted: 0,
  tacklesCompleted: 0,
  saves: 0,
  manOfTheMatch: false,
  ...overrides,
});

describe('analyseRecentPlayerMatches', () => {
  it('keeps the newest twenty-five snapshots and calculates position and efficiency metrics', () => {
    const analysis = analyseRecentPlayerMatches(
      Array.from({ length: 26 }, (_, index) =>
        match({
          position: index < 15 ? 'ST' : 'RW',
          goals: 1,
          shots: 4,
          passesAttempted: 10,
          passesCompleted: 8,
        }),
      ),
    );

    expect(analysis.windowSize).toBe(25);
    expect(analysis.matchesAvailable).toBe(25);
    expect(analysis.primaryPosition).toBe('ST');
    expect(analysis.goals).toBe(25);
    expect(analysis.shotConversion).toBe(25);
    expect(analysis.passAccuracy).toBe(80);
    expect(analysis.positionAnalysis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ position: 'ST', appearances: 15 }),
        expect.objectContaining({ position: 'RW', appearances: 10 }),
      ]),
    );
  });

  it('gives an actionable finishing insight only when the sample supports it', () => {
    const analysis = analyseRecentPlayerMatches(
      Array.from({ length: 3 }, () => match({ shots: 5, goals: 0 })),
    );

    expect(analysis.improvements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: 'Conversão' }),
      ]),
    );
  });
});
