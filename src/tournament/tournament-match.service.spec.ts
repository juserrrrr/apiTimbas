import { compareEaAutomaticQueue, formatEaMatchDuration, selectEaAutomaticQueue } from './tournament-match.service';

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

describe('formatEaMatchDuration', () => {
  it('shows minutes, seconds and the raw duration', () => {
    expect(formatEaMatchDuration(2774)).toBe('46 min 14 s (2774 segundos)');
  });
});

describe('selectEaAutomaticQueue', () => {
  const never = (round: number, position: number) => ({ eaLastCheckedAt: null, round, position });
  const checked = (minutesAgo: number, round: number, position: number) => ({
    eaLastCheckedAt: new Date(Date.now() - minutesAgo * 60_000),
    round,
    position,
  });

  it('consulta na mesma passada todas as partidas que nunca foram checadas', () => {
    const due = [never(1, 0), never(1, 1), never(1, 2), never(1, 3)];

    expect(selectEaAutomaticQueue(due, 1)).toEqual(due);
  });

  it('mantém o limite por minuto para quem já foi consultado', () => {
    const older = checked(10, 1, 0);
    const recent = checked(1, 1, 1);

    expect(selectEaAutomaticQueue([recent, older], 1)).toEqual([older]);
  });

  it('coloca a primeira consulta na frente do rodízio', () => {
    const older = checked(10, 1, 0);
    const first = never(2, 0);

    expect(selectEaAutomaticQueue([older, first], 1)).toEqual([first, older]);
  });

  it('não estoura o teto de primeiras consultas de uma vez', () => {
    const due = Array.from({ length: 12 }, (_, index) => never(1, index));

    expect(selectEaAutomaticQueue(due, 1, 8)).toHaveLength(8);
  });
});
