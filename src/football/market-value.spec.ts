import { marketValueFor, salaryFor } from './market-value';

describe('marketValueFor', () => {
  it('cresce com o overall', () => {
    expect(marketValueFor(80)).toBeGreaterThan(marketValueFor(70));
    expect(marketValueFor(90)).toBeGreaterThan(marketValueFor(80));
  });

  it('põe o craque numa escala de futebol de verdade', () => {
    expect(marketValueFor(90)).toBeGreaterThan(50_000_000);
    expect(marketValueFor(99)).toBeLessThan(1_000_000_000);
  });

  it('deixa o jogador comum acessível', () => {
    expect(marketValueFor(65)).toBeLessThan(2_000_000);
    expect(marketValueFor(50)).toBeLessThan(300_000);
  });

  it('devolve valor redondo', () => {
    for (const overall of [55, 65, 75, 85, 95]) {
      const value = marketValueFor(overall);
      expect(value % 1_000).toBe(0);
    }
  });

  it('não sai da faixa mesmo com overall absurdo', () => {
    expect(marketValueFor(-10)).toBe(marketValueFor(40));
    expect(marketValueFor(400)).toBe(marketValueFor(99));
  });
});

describe('salaryFor', () => {
  it('fica em meio por cento do valor', () => {
    const price = 100_000_000;
    expect(salaryFor(price)).toBeGreaterThan(price * 0.004);
    expect(salaryFor(price)).toBeLessThan(price * 0.006);
  });

  it('tem piso para jogador barato', () => {
    expect(salaryFor(1_000)).toBeGreaterThanOrEqual(1_000);
  });
});
