/// Confronto direto entre dois times, decidido em melhor de N jogos. Funções
/// puras, sem I/O: quem venceu a série, quantas vitórias faltam e se ainda
/// existe um próximo jogo para criar.

export const SERIES_BEST_OF_OPTIONS = [1, 3, 5, 7];

export interface SeriesOutcome {
  /// Vitórias por time nos jogos já encerrados.
  wins: Record<string, number>;
  /// Vitórias necessárias para fechar a série.
  needed: number;
  winnerTeamId: string | null;
  /// Número do próximo jogo, ou null quando a série acabou.
  nextGame: number | null;
}

export function seriesWinsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

export function bestOfIssue(bestOf: number): string | null {
  if (!SERIES_BEST_OF_OPTIONS.includes(bestOf)) {
    return `Uma série é disputada em ${SERIES_BEST_OF_OPTIONS.join(', ')} jogos.`;
  }
  return null;
}

export function seriesLabel(bestOf: number): string {
  return bestOf === 1 ? 'Jogo único' : `Melhor de ${bestOf}`;
}

export function seriesGameLabel(game: number, bestOf: number): string {
  return bestOf === 1 ? 'Jogo único' : `Jogo ${game} de ${bestOf}`;
}

/// `gameWinners` traz o vencedor de cada jogo encerrado, na ordem em que foram
/// jogados. Jogo sem vencedor não conta para ninguém: a série não aceita empate,
/// mas se um resultado assim chegar o desempate volta a ser o total de vitórias.
export function seriesOutcome(
  bestOf: number,
  teamIds: [string, string],
  gameWinners: Array<string | null>,
): SeriesOutcome {
  const needed = seriesWinsNeeded(bestOf);
  const wins: Record<string, number> = { [teamIds[0]]: 0, [teamIds[1]]: 0 };
  const played = Math.min(gameWinners.length, bestOf);

  for (let game = 0; game < played; game++) {
    const teamId = gameWinners[game];
    if (!teamId || !(teamId in wins)) continue;
    wins[teamId] += 1;
    if (wins[teamId] >= needed) {
      return { wins, needed, winnerTeamId: teamId, nextGame: null };
    }
  }

  if (played < bestOf) {
    return { wins, needed, winnerTeamId: null, nextGame: played + 1 };
  }

  const [first, second] = teamIds;
  const leader =
    wins[first] === wins[second] ? null : wins[first] > wins[second] ? first : second;
  return { wins, needed, winnerTeamId: leader, nextGame: null };
}
