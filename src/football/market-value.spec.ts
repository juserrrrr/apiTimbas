import { marketValueFor, salaryFor } from './market-value';

describe('marketValueFor', () => {
  it('cresce com o overall', () => {
    expect(marketValueFor(80)).toBeGreaterThan(marketValueFor(70));
    expect(marketValueFor(90)).toBeGreaterThan(marketValueFor(80));
    expect(marketValueFor(99)).toBeGreaterThan(marketValueFor(90));
  });

  // As faixas vêm do mercado de 2026 convertido a R$ 6,30 por euro. Se alguém
  // mexer na curva e tirar o preço da realidade, é aqui que estoura.
  it('paga o craque como o mercado paga', () => {
    // Vinícius, 140 mi de euros, na faixa de 90.
    expect(marketValueFor(90)).toBeGreaterThan(600_000_000);
    expect(marketValueFor(90)).toBeLessThan(1_100_000_000);
    // Yamal e Haaland, 200 mi de euros.
    expect(marketValueFor(95)).toBeGreaterThan(1_000_000_000);
    expect(marketValueFor(95)).toBeLessThan(1_900_000_000);
  });

  it('cobra do titular de time grande o preço de time grande', () => {
    expect(marketValueFor(80)).toBeGreaterThan(100_000_000);
    expect(marketValueFor(80)).toBeLessThan(250_000_000);
  });

  it('deixa o jogador de rodapé acessível', () => {
    expect(marketValueFor(70)).toBeLessThan(30_000_000);
    expect(marketValueFor(60)).toBeLessThan(5_000_000);
    expect(marketValueFor(50)).toBeLessThan(1_000_000);
  });

  // O teto do mundo real hoje é a projeção do CIES para o Yamal, 358 mi de euros.
  // O overall 99 tem que encostar nisso e não passar, senão a curva vira fantasia.
  it('não deixa o topo virar fantasia', () => {
    expect(marketValueFor(99)).toBeLessThan(2_500_000_000);
  });

  it('devolve valor redondo', () => {
    for (const overall of [55, 65, 75, 85, 95]) {
      expect(marketValueFor(overall) % 1_000).toBe(0);
    }
  });

  it('não sai da faixa mesmo com overall absurdo', () => {
    expect(marketValueFor(-10)).toBe(marketValueFor(40));
    expect(marketValueFor(400)).toBe(marketValueFor(99));
  });
});

describe('salaryFor', () => {
  it('cobra perto de 0,4% do valor por rodada', () => {
    const price = 100_000_000;
    expect(salaryFor(price)).toBeGreaterThan(price * 0.003);
    expect(salaryFor(price)).toBeLessThan(price * 0.005);
  });

  it('mantém a folha de uma temporada abaixo do valor do elenco', () => {
    const squad = 25 * marketValueFor(78);
    const season = 80 * 25 * salaryFor(marketValueFor(78));
    expect(season).toBeLessThan(squad);
  });

  it('tem piso para jogador barato', () => {
    expect(salaryFor(1_000)).toBeGreaterThanOrEqual(10_000);
  });
});
