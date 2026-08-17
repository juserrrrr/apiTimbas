import { DraftOrderType } from '@prisma/client';
import { nextMatchDates, pickCoordinate, roundRobinPairs, upcomingPicks } from './draft-order';

describe('pickCoordinate', () => {
  it('inverte a ordem a cada rodada no formato snake', () => {
    const order = (pickNumber: number) => pickCoordinate(pickNumber, 4, DraftOrderType.SNAKE).rosterIndex;
    expect([0, 1, 2, 3].map(order)).toEqual([0, 1, 2, 3]);
    expect([4, 5, 6, 7].map(order)).toEqual([3, 2, 1, 0]);
    expect([8, 9, 10, 11].map(order)).toEqual([0, 1, 2, 3]);
  });

  it('mantém a mesma ordem no formato linear', () => {
    const order = (pickNumber: number) => pickCoordinate(pickNumber, 3, DraftOrderType.LINEAR).rosterIndex;
    expect([0, 1, 2, 3, 4, 5].map(order)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('conta as rodadas a partir de 1', () => {
    expect(pickCoordinate(0, 4, DraftOrderType.SNAKE).round).toBe(1);
    expect(pickCoordinate(3, 4, DraftOrderType.SNAKE).round).toBe(1);
    expect(pickCoordinate(4, 4, DraftOrderType.SNAKE).round).toBe(2);
  });
});

describe('upcomingPicks', () => {
  it('para quando o draft acaba', () => {
    expect(upcomingPicks(10, 12, 4, DraftOrderType.SNAKE, 6)).toHaveLength(2);
  });
});

describe('roundRobinPairs', () => {
  it('agenda todos contra todos', () => {
    const fixtures = roundRobinPairs(6);
    expect(fixtures).toHaveLength(15);
    expect(new Set(fixtures.map((fixture) => fixture.round)).size).toBe(5);
  });

  it('não repete um elenco na mesma rodada', () => {
    for (const round of [1, 2, 3]) {
      const inRound = roundRobinPairs(8).filter((fixture) => fixture.round === round);
      const involved = inRound.flatMap((fixture) => [fixture.home, fixture.away]);
      expect(new Set(involved).size).toBe(involved.length);
    }
  });
});

describe('nextMatchDates', () => {
  it('cai só nos dias configurados', () => {
    const monday = new Date('2026-08-17T10:00:00');
    const dates = nextMatchDates(monday, [0, 3], 21, 4);
    expect(dates.map((date) => date.getDay())).toEqual([3, 0, 3, 0]);
    expect(dates.every((date) => date.getHours() === 21)).toBe(true);
  });

  it('sempre começa depois da data informada', () => {
    const start = new Date('2026-08-19T23:00:00');
    const [first] = nextMatchDates(start, [3], 21, 1);
    expect(first.getTime()).toBeGreaterThan(start.getTime());
  });
});
