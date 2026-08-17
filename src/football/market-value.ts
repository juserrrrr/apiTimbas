/// Valor de mercado e salário na escala do futebol de verdade, em reais.
/// A curva é exponencial de propósito: entre 70 e 80 de overall o preço quase
/// decuplica, que é o que separa um titular de time médio de um craque.

const BASE = 120_000;
const GROWTH = 1.185;

/// Preço de um jogador a partir do overall, arredondado para ficar legível.
export function marketValueFor(overall: number): number {
  const level = Math.min(99, Math.max(40, Math.round(overall)));
  const raw = BASE * GROWTH ** (level - 50);
  return roundToScale(raw);
}

/// Salário por rodada: meio por cento do valor do jogador, que é a proporção que
/// mantém a folha pesada sem quebrar o clube em uma temporada.
export function salaryFor(price: number): number {
  return roundToScale(Math.max(1_000, price / 200));
}

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
  if (value >= 10_000_000) return Math.round(value / 500_000) * 500_000;
  if (value >= 1_000_000) return Math.round(value / 100_000) * 100_000;
  if (value >= 100_000) return Math.round(value / 10_000) * 10_000;
  return Math.round(value / 1_000) * 1_000;
}
