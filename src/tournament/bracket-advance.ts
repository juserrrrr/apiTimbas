import { MatchSlot, Prisma, TournamentMatch, TournamentMatchStatus, TournamentPhase } from '@prisma/client';

const KNOCKOUT_PHASES: TournamentPhase[] = [
  TournamentPhase.WINNERS,
  TournamentPhase.LOSERS,
  TournamentPhase.GRAND_FINAL,
  TournamentPhase.THIRD_PLACE,
];

export function isKnockout(phase: TournamentPhase): boolean {
  return KNOCKOUT_PHASES.includes(phase);
}

export async function placeTeam(
  tx: Prisma.TransactionClient,
  matchId: string,
  slot: MatchSlot,
  teamId: string,
) {
  const target = await tx.tournamentMatch.update({
    where: { id: matchId },
    data: slot === MatchSlot.HOME ? { homeTeamId: teamId } : { awayTeamId: teamId },
  });

  if (target.homeTeamId && target.awayTeamId && target.status === TournamentMatchStatus.PENDING) {
    await tx.tournamentMatch.update({
      where: { id: target.id },
      data: { status: TournamentMatchStatus.READY },
    });
  }
  return target;
}

export async function propagate(
  tx: Prisma.TransactionClient,
  match: TournamentMatch,
  winnerTeamId: string,
  loserTeamId: string | null,
) {
  if (match.nextMatchId && match.nextMatchSlot) {
    await placeTeam(tx, match.nextMatchId, match.nextMatchSlot, winnerTeamId);
  }

  if (!loserTeamId) return;

  if (match.loserNextMatchId && match.loserNextMatchSlot) {
    await placeTeam(tx, match.loserNextMatchId, match.loserNextMatchSlot, loserTeamId);
    return;
  }

  if (isKnockout(match.phase) && match.phase !== TournamentPhase.THIRD_PLACE) {
    await tx.tournamentTeam.update({ where: { id: loserTeamId }, data: { eliminated: true } });
  }
}

/// Avança sozinho quem ficou com o adversário impossível: a vaga vazia não tem
/// partida que a alimente (bye da primeira rodada) ou o alimentador já terminou
/// sem produzir ninguém para aquele lado (W.O. não gera perdedor). Roda em laço
/// porque um avanço pode deixar a partida seguinte na mesma situação.
export async function resolveWalkovers(tx: Prisma.TransactionClient, tournamentId: string) {
  for (let pass = 0; pass < 16; pass++) {
    const pending = await tx.tournamentMatch.findMany({
      where: {
        tournamentId,
        status: TournamentMatchStatus.PENDING,
        phase: { in: KNOCKOUT_PHASES },
      },
      orderBy: [{ round: 'asc' }, { position: 'asc' }],
    });

    let advanced = 0;
    for (const match of pending) {
      if (match.homeTeamId && match.awayTeamId) continue;
      const soleTeam = match.homeTeamId ?? match.awayTeamId;
      if (!soleTeam) continue;

      const emptySlot = match.homeTeamId ? MatchSlot.AWAY : MatchSlot.HOME;
      const feeders = await tx.tournamentMatch.findMany({
        where: {
          tournamentId,
          OR: [
            { nextMatchId: match.id, nextMatchSlot: emptySlot },
            { loserNextMatchId: match.id, loserNextMatchSlot: emptySlot },
          ],
        },
        select: { status: true },
      });
      const stillLive = feeders.some(
        (feeder) =>
          feeder.status !== TournamentMatchStatus.FINISHED &&
          feeder.status !== TournamentMatchStatus.WALKOVER,
      );
      if (stillLive) continue;

      const updated = await tx.tournamentMatch.update({
        where: { id: match.id },
        data: {
          status: TournamentMatchStatus.WALKOVER,
          winnerTeamId: soleTeam,
          playedAt: new Date(),
          label: match.label ? `${match.label} (W.O.)` : 'W.O.',
        },
      });
      await propagate(tx, updated, soleTeam, null);
      advanced++;
    }

    if (advanced === 0) return;
  }
}
