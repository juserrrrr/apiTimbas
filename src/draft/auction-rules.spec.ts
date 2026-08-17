import { extendedDeadline, minimumBid } from './auction-rules';

describe('minimumBid', () => {
  it('o primeiro lance é o valor inicial', () => {
    expect(minimumBid(0, 200, 0, 5)).toBe(200);
  });

  it('sobe pela porcentagem do lance atual', () => {
    expect(minimumBid(200, 200, 1, 5)).toBe(210);
    expect(minimumBid(1000, 200, 3, 10)).toBe(1100);
  });

  it('sobe pelo menos uma moeda quando a porcentagem arredonda para nada', () => {
    expect(minimumBid(10, 10, 1, 0)).toBe(11);
    expect(minimumBid(5, 5, 2, 1)).toBe(6);
  });
});

describe('extendedDeadline', () => {
  const now = new Date('2026-08-17T20:00:00Z');

  it('empurra o prazo quando o lance entra na reta final', () => {
    const endsAt = new Date('2026-08-17T20:02:00Z');
    expect(extendedDeadline(endsAt, now, 5).toISOString()).toBe('2026-08-17T20:05:00.000Z');
  });

  it('não mexe no prazo quando ainda falta tempo', () => {
    const endsAt = new Date('2026-08-17T23:00:00Z');
    expect(extendedDeadline(endsAt, now, 5)).toBe(endsAt);
  });

  it('respeita a prorrogação desligada', () => {
    const endsAt = new Date('2026-08-17T20:00:30Z');
    expect(extendedDeadline(endsAt, now, 0)).toBe(endsAt);
  });
});
