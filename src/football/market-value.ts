/// Valor de mercado e salário na escala do futebol de verdade, em reais.
///
/// A curva é calibrada pelo mercado de 2026 (Transfermarkt e CIES), convertido a
/// R$ 6,30 por euro:
///
///   Yamal e Haaland, 200 mi de euros  -> cerca de R$ 1,26 bi
///   Mbappé, 180 mi                    -> cerca de R$ 1,13 bi
///   Vinícius Júnior, 140 mi           -> cerca de R$ 880 mi
///   titular de time grande, 25 a 35   -> R$ 160 a 220 mi
///   titular de time médio, 3 a 5      -> R$ 20 a 30 mi
///
/// Por isso são duas inclinações. Até 88 o preço quase dobra a cada três pontos,
/// que é o que separa um titular comum de um craque. Acima de 88 ela abre menos,
/// porque no mercado de verdade só existe um punhado de clubes capaz de pagar, e
/// isso segura o topo: sem essa freada o overall 99 sairia por dezenas de bilhões.

const BASE = 400_000;
const GROWTH = 1.215;
const ELITE_FROM = 88;
const ELITE_GROWTH = 1.115;

/// Preço de um jogador a partir do overall, arredondado para ficar legível.
export function marketValueFor(overall: number): number {
  const level = Math.min(99, Math.max(40, Math.round(overall)));
  const common = Math.min(level, ELITE_FROM) - 50;
  const elite = Math.max(0, level - ELITE_FROM);
  return roundToScale(BASE * GROWTH ** common * ELITE_GROWTH ** elite);
}

/// Salário por rodada: 0,4% do valor do jogador. Numa temporada de oitenta
/// rodadas a folha come perto de um terço do que o elenco vale, que é a mesma
/// proporção que aperta um clube de verdade.
export function salaryFor(price: number): number {
  return roundToScale(Math.max(10_000, price / 250));
}

/// Caixa com que cada elenco começa a liga. Dá para pagar a folha de uma
/// temporada e ainda comprar um titular de time grande, mas não um craque sem
/// vender ninguém antes: é o aperto que faz o mercado existir.
export const DEFAULT_STARTING_BUDGET = 800_000_000;

/// Bilheteria da rodada. Está calibrada contra a folha: um elenco de vinte e
/// cinco jogadores em torno de 75 de overall paga perto de R$ 7 mi por rodada,
/// então quem vence quase dobra o que gastou e quem perde fica no vermelho. É
/// isso que obriga a vender alguém em vez de só acumular.
export const DEFAULT_ROUND_PRIZE = {
  win: 15_000_000,
  draw: 6_000_000,
  loss: 2_000_000,
};

/// Dinheiro em texto, do jeito que a pessoa lê na tela: R$ 12,5 mi.
export function formatMoney(value: number): string {
  const amount = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (amount >= 1_000_000_000) return `${sign}R$ ${trim(amount / 1_000_000_000)} bi`;
  if (amount >= 1_000_000) return `${sign}R$ ${trim(amount / 1_000_000)} mi`;
  if (amount >= 100_000) return `${sign}R$ ${trim(amount / 1_000)} mil`;
  return `${sign}R$ ${amount.toLocaleString('pt-BR')}`;
}

function trim(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

/// Arredonda para um número redondo na casa do valor, para o mercado não ficar
/// cheio de preço quebrado.
function roundToScale(value: number): number {
  if (value >= 100_000_000) return Math.round(value / 5_000_000) * 5_000_000;
  if (value >= 10_000_000) return Math.round(value / 500_000) * 500_000;
  if (value >= 1_000_000) return Math.round(value / 100_000) * 100_000;
  if (value >= 100_000) return Math.round(value / 10_000) * 10_000;
  return Math.round(value / 1_000) * 1_000;
}
