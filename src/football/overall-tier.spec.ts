import { OVERALL_TIERS, countByTier, tierOf } from './overall-tier';

describe('tierOf', () => {
  it('separa nas casas de dez', () => {
    expect(tierOf(93).id).toBe('ELITE');
    expect(tierOf(90).id).toBe('ELITE');
    expect(tierOf(89).id).toBe('STAR');
    expect(tierOf(80).id).toBe('STAR');
    expect(tierOf(79).id).toBe('STARTER');
    expect(tierOf(70).id).toBe('STARTER');
    expect(tierOf(69).id).toBe('SQUAD');
  });

  it('não deixa buraco entre as faixas', () => {
    for (let overall = 0; overall <= 99; overall += 1) {
      const tier = tierOf(overall);
      expect(overall).toBeGreaterThanOrEqual(tier.min);
      expect(overall).toBeLessThanOrEqual(tier.max);
    }
  });
});

describe('countByTier', () => {
  it('conta cada faixa e não perde ninguém', () => {
    const players = [{ overall: 91 }, { overall: 85 }, { overall: 84 }, { overall: 72 }, { overall: 61 }];
    const counts = countByTier(players);

    expect(counts.map((tier) => tier.count)).toEqual([1, 2, 1, 1]);
    expect(counts.reduce((total, tier) => total + tier.count, 0)).toBe(players.length);
    expect(counts.map((tier) => tier.id)).toEqual(OVERALL_TIERS.map((tier) => tier.id));
  });
});
