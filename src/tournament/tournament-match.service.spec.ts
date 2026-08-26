import { compareEaAutomaticQueue } from './tournament-match.service';

describe('compareEaAutomaticQueue', () => {
  it('checks every never-searched match before repeating an earlier round', () => {
    const recentlyCheckedRoundOne = {
      eaLastCheckedAt: new Date('2026-08-26T01:30:00.000Z'),
      round: 1,
      position: 1,
    };
    const neverCheckedRoundThree = {
      eaLastCheckedAt: null,
      round: 3,
      position: 1,
    };

    expect([recentlyCheckedRoundOne, neverCheckedRoundThree].sort(compareEaAutomaticQueue))
      .toEqual([neverCheckedRoundThree, recentlyCheckedRoundOne]);
  });

  it('prioritizes the earliest round when matches have the same check age', () => {
    const roundThree = { eaLastCheckedAt: null, round: 3, position: 1 };
    const roundOne = { eaLastCheckedAt: null, round: 1, position: 2 };

    expect([roundThree, roundOne].sort(compareEaAutomaticQueue)).toEqual([roundOne, roundThree]);
  });
});
