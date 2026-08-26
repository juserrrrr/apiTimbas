import { Prisma, TournamentMatchStatus } from '@prisma/client';

/// Rótulo do W.O. entra como sufixo no label da partida. Zerar o resultado sem
/// tirar o sufixo deixaria "Rodada 1 (W.O.)" numa partida que voltou a ser aberta.
export function stripWalkoverLabel(label: string | null): string | null {
  if (!label) return label;
  return label.replace(/ \(W\.O\.(?::.*)?\)$/, '');
}

export type ReplacedMatch = {
  label: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
};

/// Volta a partida ao estado de quem ainda não jogou: sem placar, sem registro
/// da EA, sem placar informado e sem pedido de revisão. A partida com os dois
/// times definidos volta como READY, e readyAt reinicia o prazo de W.O.
export function clearedMatchState(match: ReplacedMatch, eaCheckMessage: string, now = new Date()) {
  const bothTeams = Boolean(match.homeTeamId && match.awayTeamId);
  return {
    homeScore: null,
    awayScore: null,
    winnerTeamId: null,
    status: bothTeams ? TournamentMatchStatus.READY : TournamentMatchStatus.PENDING,
    readyAt: bothTeams ? now : null,
    playedAt: null,
    reportedByDiscordId: null,
    label: stripWalkoverLabel(match.label),
    homeReadyAt: null,
    awayReadyAt: null,
    homeGraceUsed: false,
    awayGraceUsed: false,
    scheduleProposedAt: null,
    scheduleProposedByTeamId: null,
    claimedHomeScore: null,
    claimedAwayScore: null,
    claimedByTeamId: null,
    claimedAt: null,
    reviewRequestedAt: null,
    reviewRequestedById: null,
    reviewReason: null,
    eaMatchId: null,
    eaVerifiedAt: null,
    eaRaw: Prisma.DbNull,
    eaTags: [],
    eaLastCheckedAt: null,
    eaNextCheckAt: null,
    eaCheckMessage,
  };
}

export type PointsRules = { pointsWin: number; pointsDraw: number; pointsLoss: number };

/// Tira da tabela o que uma partida somou. Usada quando o resultado é apagado:
/// o adversário do time substituído continua no campeonato e só pode perder o
/// que ganhou naquele jogo.
export function reversedStandingsDelta(rules: PointsRules, scored: number, conceded: number) {
  const isWin = scored > conceded;
  const isDraw = scored === conceded;
  return {
    played: { decrement: 1 },
    wins: { decrement: isWin ? 1 : 0 },
    draws: { decrement: isDraw ? 1 : 0 },
    losses: { decrement: !isWin && !isDraw ? 1 : 0 },
    scoreFor: { decrement: scored },
    scoreAgainst: { decrement: conceded },
    points: { decrement: isWin ? rules.pointsWin : isDraw ? rules.pointsDraw : rules.pointsLoss },
  };
}

/// Zera a ficha do time que trocou de clube: quem entrou começa do zero, sem
/// herdar pontos, saldo nem eliminação do clube anterior.
export const EMPTY_STANDINGS = {
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  scoreFor: 0,
  scoreAgainst: 0,
  points: 0,
  eliminated: false,
};
