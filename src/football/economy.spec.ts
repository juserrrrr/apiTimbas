import {
  DEFAULT_ROUND_PRIZE,
  DEFAULT_STARTING_BUDGET,
  marketValueFor,
  salaryFor,
} from './market-value';

/// A economia da liga só funciona se três números conversarem: o que o elenco
/// vale, o que ele custa por rodada e o que a rodada paga. Mexer em um sem olhar
/// os outros quebra a liga em silêncio, meia temporada depois, então o equilíbrio
/// fica travado aqui.

const SQUAD_SIZE = 25;
const TYPICAL_OVERALL = 75;
const SEASON_ROUNDS = 38;

const wageBill = SQUAD_SIZE * salaryFor(marketValueFor(TYPICAL_OVERALL));

describe('equilíbrio da liga', () => {
  it('faz a vitória cobrir a folha da rodada', () => {
    expect(DEFAULT_ROUND_PRIZE.win).toBeGreaterThan(wageBill);
  });

  it('deixa quem perde no vermelho', () => {
    expect(DEFAULT_ROUND_PRIZE.loss).toBeLessThan(wageBill);
  });

  it('mantém o empate perto do empate', () => {
    expect(DEFAULT_ROUND_PRIZE.draw).toBeLessThan(DEFAULT_ROUND_PRIZE.win);
    expect(DEFAULT_ROUND_PRIZE.draw).toBeGreaterThan(DEFAULT_ROUND_PRIZE.loss);
  });

  it('não deixa o caixa comprar um time inteiro', () => {
    // O caixa é para reforço, não para montar elenco por fora do draft: se desse
    // para comprar onze titulares, escolher bem no draft não valeria nada.
    expect(DEFAULT_STARTING_BUDGET).toBeLessThan(11 * marketValueFor(80));
  });

  it('faz a temporada se pagar pelo resultado, e não pelo caixa', () => {
    // Quem ganha metade das rodadas e empata o resto fecha a temporada no azul.
    // Quem perde metade não fecha, e aí precisa vender.
    const meioBom = (SEASON_ROUNDS / 2) * (DEFAULT_ROUND_PRIZE.win + DEFAULT_ROUND_PRIZE.draw);
    const ruim = (SEASON_ROUNDS / 2) * (DEFAULT_ROUND_PRIZE.draw + DEFAULT_ROUND_PRIZE.loss);
    const folha = SEASON_ROUNDS * wageBill;

    expect(meioBom).toBeGreaterThan(folha);
    expect(ruim).toBeLessThan(folha + DEFAULT_STARTING_BUDGET);
  });

  it('deixa o caixa inicial comprar um titular de time grande, e não um craque', () => {
    expect(DEFAULT_STARTING_BUDGET).toBeGreaterThan(marketValueFor(82));
    expect(DEFAULT_STARTING_BUDGET).toBeLessThan(marketValueFor(90));
  });
});
