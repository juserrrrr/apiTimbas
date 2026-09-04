import { selectPreferredFormation } from './ea-formation';

describe('selectPreferredFormation', () => {
  it('prefers the most repeated formation, then its wins and draws', () => {
    const choice = selectPreferredFormation([
      { id: 'new-loss', playedAt: new Date('2026-09-03'), result: 'LOSS', positions: ['GK', 'DEFENDER', 'DEFENDER', 'MIDFIELDER', 'FORWARD'] },
      { id: 'win', playedAt: new Date('2026-09-02'), result: 'WIN', positions: ['GK', 'DEFENDER', 'DEFENDER', 'FORWARD', 'FORWARD'] },
      { id: 'draw', playedAt: new Date('2026-09-01'), result: 'DRAW', positions: ['GK', 'DEFENDER', 'DEFENDER', 'FORWARD', 'FORWARD'] },
    ]);

    expect(choice).toEqual({ formation: '2-0-2', matches: 2, wins: 1, draws: 1, matchId: 'win' });
  });
});
