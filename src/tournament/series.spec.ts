import { bestOfIssue, seriesOutcome, seriesWinsNeeded } from './series';

const TEAMS: [string, string] = ['home', 'away'];

describe('seriesWinsNeeded', () => {
  it('exige a metade mais um dos jogos', () => {
    expect(seriesWinsNeeded(1)).toBe(1);
    expect(seriesWinsNeeded(3)).toBe(2);
    expect(seriesWinsNeeded(5)).toBe(3);
    expect(seriesWinsNeeded(7)).toBe(4);
  });
});

describe('bestOfIssue', () => {
  it('aceita somente número ímpar de 1 a 7', () => {
    expect(bestOfIssue(3)).toBeNull();
    expect(bestOfIssue(2)).toContain('série');
    expect(bestOfIssue(9)).toContain('série');
  });
});

describe('seriesOutcome', () => {
  it('abre a série no primeiro jogo', () => {
    expect(seriesOutcome(3, TEAMS, [])).toEqual({
      wins: { home: 0, away: 0 },
      needed: 2,
      winnerTeamId: null,
      nextGame: 1,
    });
  });

  it('pede o próximo jogo enquanto ninguém fecha', () => {
    const outcome = seriesOutcome(5, TEAMS, ['home', 'away', 'home']);
    expect(outcome.winnerTeamId).toBeNull();
    expect(outcome.nextGame).toBe(4);
    expect(outcome.wins).toEqual({ home: 2, away: 1 });
  });

  it('encerra assim que alguém chega às vitórias necessárias', () => {
    const outcome = seriesOutcome(3, TEAMS, ['away', 'away']);
    expect(outcome.winnerTeamId).toBe('away');
    expect(outcome.nextGame).toBeNull();
  });

  it('não conta jogo além do necessário para fechar', () => {
    const outcome = seriesOutcome(5, TEAMS, ['home', 'home', 'home', 'away']);
    expect(outcome.wins).toEqual({ home: 3, away: 0 });
    expect(outcome.winnerTeamId).toBe('home');
  });

  it('decide jogo único no primeiro resultado', () => {
    expect(seriesOutcome(1, TEAMS, ['home']).winnerTeamId).toBe('home');
    expect(seriesOutcome(1, TEAMS, []).nextGame).toBe(1);
  });

  it('empate em jogo não conta para ninguém e o total decide no fim', () => {
    const outcome = seriesOutcome(3, TEAMS, ['home', null, null]);
    expect(outcome.wins).toEqual({ home: 1, away: 0 });
    expect(outcome.winnerTeamId).toBe('home');
    expect(outcome.nextGame).toBeNull();
  });

  it('série toda empatada não tem campeão', () => {
    expect(seriesOutcome(3, TEAMS, [null, null, null]).winnerTeamId).toBeNull();
  });
});
