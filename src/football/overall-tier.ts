/// Faixas de overall. Servem para separar a base e a lista do draft em blocos de
/// dez, que é como a pessoa pensa o jogador: noventa é craque, oitenta é estrela,
/// setenta é titular. Sem isso uma base de mil nomes vira uma lista sem relevo.

export type OverallTierId = 'ELITE' | 'STAR' | 'STARTER' | 'SQUAD';

export interface OverallTier {
  id: OverallTierId;
  label: string;
  short: string;
  min: number;
  max: number;
}

export const OVERALL_TIERS: OverallTier[] = [
  { id: 'ELITE', label: 'Craques', short: '90+', min: 90, max: 99 },
  { id: 'STAR', label: 'Estrelas', short: '80-89', min: 80, max: 89 },
  { id: 'STARTER', label: 'Titulares', short: '70-79', min: 70, max: 79 },
  { id: 'SQUAD', label: 'Elenco', short: '< 70', min: 0, max: 69 },
];

/// Em qual faixa o jogador cai. Overall fora da escala cai na ponta mais próxima.
export function tierOf(overall: number): OverallTier {
  const level = Math.round(overall);
  return OVERALL_TIERS.find((tier) => level >= tier.min) ?? OVERALL_TIERS[OVERALL_TIERS.length - 1];
}

/// Quantos jogadores há em cada faixa, na ordem do craque para o elenco. A tela
/// do draft usa isso para mostrar o que ainda sobrou de bom no pool.
export function countByTier<T extends { overall: number }>(
  players: T[],
): Array<OverallTier & { count: number }> {
  return OVERALL_TIERS.map((tier) => ({
    ...tier,
    count: players.filter((player) => tierOf(player.overall).id === tier.id).length,
  }));
}
