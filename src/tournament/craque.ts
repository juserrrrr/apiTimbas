/**
 * Índice do craque do campeonato.
 *
 * A nota da EA sozinha não elegia craque: ela premia quem joga limpo em quatro
 * partidas e ignora quem decidiu o campeonato. Um zagueiro com 9,2 de média e
 * nenhuma participação em gol passava na frente de um atacante com dez
 * participações, e não é isso que a palavra craque quer dizer aqui.
 *
 * O índice parte da nota, porque ela é a única medida que a EA calcula olhando
 * a partida inteira, e soma o que a nota trata de leve: produção ofensiva,
 * volume defensivo, trabalho de goleiro, passe e presença. Cada parcela é
 * normalizada pelo melhor do próprio campeonato, então o peso é sempre relativo
 * aos adversários daquela competição, e não a um número mágico de fora.
 */

export interface CraquePlayerStats {
  appearances: number;
  ratedAppearances: number;
  averageRating: number | null;
  teamMatches: number;
  goals: number;
  assists: number;
  mvps: number;
  tacklesCompleted: number;
  tackleSuccess: number | null;
  saves: number;
  shots: number;
  passesCompleted: number;
  passAccuracy: number | null;
}

export interface CraqueWeights {
  contributions: number;
  tackles: number;
  saves: number;
  shooting: number;
  passing: number;
  mvp: number;
  presence: number;
}

/**
 * Produção ofensiva é o que mais move o índice depois da nota: é a parcela que
 * separa quem decidiu partida de quem só não errou. Defesa e goleiro entram com
 * peso próprio para que o campeonato não vire uma lista de atacantes, e passe
 * entra por último porque volume de passe certo é fácil de inflar tocando de
 * lado.
 */
export const DEFAULT_CRAQUE_WEIGHTS: CraqueWeights = {
  contributions: 1.4,
  tackles: 0.55,
  saves: 0.55,
  shooting: 0.35,
  passing: 0.35,
  mvp: 0.65,
  presence: 0.3,
};

/// Partidas fantasma que puxam a nota de quem jogou pouco para a média do
/// campeonato. Sem isso, três jogos inspirados valeriam mais que uma campanha.
const RATING_PRIOR_GAMES = 2;
const ASSIST_VALUE = 0.5;

function perGame(total: number, appearances: number) {
  return appearances > 0 ? total / appearances : 0;
}

/// Normaliza pelo melhor do campeonato: 1 é o teto daquela competição, 0 é quem
/// não produziu nada naquela parcela.
function share(value: number, best: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(best) || best <= 0) return 0;
  return Math.min(1, value / best);
}

export interface CraqueBreakdown {
  score: number;
  adjustedRating: number;
  contributions: number;
  tackles: number;
  saves: number;
  shooting: number;
  passing: number;
  mvp: number;
  presence: number;
}

/**
 * Devolve uma função que pontua um atleta dentro do contexto do campeonato:
 * a média geral serve de âncora para a nota, e os melhores de cada parcela
 * servem de teto para as demais.
 */
export function craqueRanker(
  pool: CraquePlayerStats[],
  tournamentAverageRating: number,
  weights: CraqueWeights = DEFAULT_CRAQUE_WEIGHTS,
) {
  const best = {
    contributions: Math.max(
      0,
      ...pool.map((player) =>
        perGame(player.goals + player.assists * ASSIST_VALUE, player.appearances),
      ),
    ),
    tackles: Math.max(
      0,
      ...pool.map(
        (player) =>
          perGame(player.tacklesCompleted, player.appearances) *
          ((player.tackleSuccess ?? 0) / 100),
      ),
    ),
    saves: Math.max(0, ...pool.map((player) => perGame(player.saves, player.appearances))),
    shooting: Math.max(0, ...pool.map((player) => perGame(player.shots, player.appearances))),
    passing: Math.max(0, ...pool.map((player) => perGame(player.passesCompleted, player.appearances))),
    appearances: Math.max(0, ...pool.map((player) => player.appearances)),
  };

  return (player: CraquePlayerStats): CraqueBreakdown => {
    const adjustedRating =
      ((player.averageRating ?? 0) * player.ratedAppearances +
        tournamentAverageRating * RATING_PRIOR_GAMES) /
      (player.ratedAppearances + RATING_PRIOR_GAMES);

    const contributions =
      weights.contributions *
      share(
        perGame(player.goals + player.assists * ASSIST_VALUE, player.appearances),
        best.contributions,
      );
    const tackles =
      weights.tackles *
      share(
        perGame(player.tacklesCompleted, player.appearances) *
          ((player.tackleSuccess ?? 0) / 100),
        best.tackles,
      );
    const saves = weights.saves * share(perGame(player.saves, player.appearances), best.saves);
    // Finalizações medem presença ofensiva, mas recebem menos peso que gols e
    // assistências para não premiar quem apenas chuta muito sem decidir.
    const shooting =
      weights.shooting * share(perGame(player.shots, player.appearances), best.shooting);
    // Passe certo só conta na proporção do acerto: quem tenta muito e erra
    // muito não deveria subir por volume.
    const passing =
      weights.passing *
      share(perGame(player.passesCompleted, player.appearances), best.passing) *
      ((player.passAccuracy ?? 0) / 100);
    const mvp = weights.mvp * (player.appearances > 0 ? player.mvps / player.appearances : 0);
    const presence = weights.presence * share(player.appearances, best.appearances);
    const rawScore =
      adjustedRating + contributions + tackles + saves + shooting + passing + mvp + presence;
    // Acima de 9 o índice se aproxima de 10 sem criar empates artificiais no teto.
    const score = rawScore <= 9 ? rawScore : 9 + (rawScore - 9) / (1 + rawScore - 9);

    return {
      score,
      adjustedRating,
      contributions,
      tackles,
      saves,
      shooting,
      passing,
      mvp,
      presence,
    };
  };
}
