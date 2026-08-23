import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  Tournament,
  TournamentMatch,
  TournamentMatchStatus,
  TournamentPhase,
  TournamentStatus,
  WalletTxType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../economy/wallet.service';
import { bracketSizeFor, compareStandings, orderGroupQualifiers, seedSlots } from './bracket.builder';
import { isKnockout, placeTeam, propagate, resolveWalkovers } from './bracket-advance';

const OPEN_STATUSES: TournamentMatchStatus[] = [
  TournamentMatchStatus.PENDING,
  TournamentMatchStatus.READY,
  TournamentMatchStatus.AWAITING_PROOF,
  TournamentMatchStatus.DISPUTED,
];

@Injectable()
export class TournamentResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async settle(matchId: string, homeScore: number, awayScore: number, reportedByDiscordId: string) {
    const match = await this.prisma.tournamentMatch.findUnique({
      where: { id: matchId },
      include: { tournament: true },
    });
    if (!match) throw new NotFoundException('Partida não encontrada.');
    this.assertScoreIsValid(match, match.tournament, homeScore, awayScore);

    return this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.tournamentMatch.updateMany({
          where: { id: matchId, status: { in: OPEN_STATUSES } },
          data: { status: TournamentMatchStatus.FINISHED },
        });
        if (claimed.count === 0) throw new BadRequestException('Esta partida já foi encerrada.');
        const winnerTeamId =
          homeScore === awayScore ? null : homeScore > awayScore ? match.homeTeamId! : match.awayTeamId!;
        const loserTeamId =
          homeScore === awayScore ? null : homeScore > awayScore ? match.awayTeamId! : match.homeTeamId!;

        const updated = await tx.tournamentMatch.update({
          where: { id: matchId },
          data: {
            homeScore,
            awayScore,
            winnerTeamId,
            status: TournamentMatchStatus.FINISHED,
            playedAt: new Date(),
            reportedByDiscordId,
          },
        });

        await this.applyTeamStats(tx, match.tournament, match.phase, match.homeTeamId!, homeScore, awayScore);
        await this.applyTeamStats(tx, match.tournament, match.phase, match.awayTeamId!, awayScore, homeScore);
        await this.payMatch(tx, match.tournament, match.homeTeamId!, match.awayTeamId!, homeScore, awayScore, matchId);

        if (winnerTeamId && isKnockout(match.phase)) {
          await propagate(tx, updated, winnerTeamId, loserTeamId);
        }

        await this.qualifyFromGroups(tx, match.tournament);
        await this.maybeFinish(tx, match.tournament);

        return updated;
      },
      { timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async walkover(
    tournamentId: string,
    matchId: string,
    winnerTeamId: string,
    reason: string | undefined,
    reportedByDiscordId: string,
  ) {
    const match = await this.prisma.tournamentMatch.findFirst({
      where: { id: matchId, tournamentId },
      include: { tournament: true },
    });
    if (!match) throw new NotFoundException('Partida não encontrada neste campeonato.');
    this.assertMatchIsOpen(match);
    if (match.homeTeamId !== winnerTeamId && match.awayTeamId !== winnerTeamId) {
      throw new BadRequestException('O vencedor precisa ser um dos times da partida.');
    }

    const loserTeamId = (match.homeTeamId === winnerTeamId ? match.awayTeamId : match.homeTeamId)!;

    return this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.tournamentMatch.updateMany({
          where: { id: matchId, status: { in: OPEN_STATUSES } },
          data: { status: TournamentMatchStatus.WALKOVER },
        });
        if (claimed.count === 0) throw new BadRequestException('Esta partida já foi encerrada.');
        const updated = await tx.tournamentMatch.update({
          where: { id: matchId },
          data: {
            status: TournamentMatchStatus.WALKOVER,
            winnerTeamId,
            homeScore: match.homeTeamId === winnerTeamId ? 1 : 0,
            awayScore: match.awayTeamId === winnerTeamId ? 1 : 0,
            playedAt: new Date(),
            reportedByDiscordId,
            label: reason ? `${match.label ?? 'Partida'} (W.O.: ${reason})` : match.label,
          },
        });

        await this.applyTeamStats(tx, match.tournament, match.phase, winnerTeamId, 1, 0);
        await this.applyTeamStats(tx, match.tournament, match.phase, loserTeamId, 0, 1);
        await propagate(tx, updated, winnerTeamId, loserTeamId);
        await this.qualifyFromGroups(tx, match.tournament);
        await this.maybeFinish(tx, match.tournament);

        return updated;
      },
      { timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async reopen(matchId: string) {
    const match = await this.prisma.tournamentMatch.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('Partida não encontrada.');
    if (match.status !== TournamentMatchStatus.AWAITING_PROOF && match.status !== TournamentMatchStatus.DISPUTED) {
      throw new BadRequestException('Só é possível reabrir partidas aguardando prova ou em disputa.');
    }
    return this.prisma.tournamentMatch.update({
      where: { id: matchId },
      data: {
        status: match.homeTeamId && match.awayTeamId ? TournamentMatchStatus.READY : TournamentMatchStatus.PENDING,
        readyAt: match.readyAt ?? new Date(),
      },
    });
  }

  assertScoreIsValid(match: TournamentMatch, tournament: Tournament, homeScore: number, awayScore: number) {
    this.assertMatchIsOpen(match);
    if (homeScore !== awayScore) return;
    if (isKnockout(match.phase)) {
      throw new BadRequestException('Mata-mata não aceita empate. Informe o placar da decisão nos pênaltis.');
    }
    if (!tournament.allowDraws) {
      throw new BadRequestException('Este campeonato não aceita empates.');
    }
  }

  private assertMatchIsOpen(match: TournamentMatch) {
    if (!match.homeTeamId || !match.awayTeamId) {
      throw new BadRequestException('A partida ainda não tem os dois times definidos.');
    }
    if (match.status === TournamentMatchStatus.FINISHED || match.status === TournamentMatchStatus.WALKOVER) {
      throw new BadRequestException('Esta partida já foi encerrada.');
    }
  }

  /// A tabela representa só a fase de pontos: somar mata-mata nela faria os
  /// grupos mudarem de ordem depois de classificados.
  private async applyTeamStats(
    tx: Prisma.TransactionClient,
    tournament: Tournament,
    phase: TournamentPhase,
    teamId: string,
    scored: number,
    conceded: number,
  ) {
    if (isKnockout(phase)) return;
    const isWin = scored > conceded;
    const isDraw = scored === conceded;
    await tx.tournamentTeam.update({
      where: { id: teamId },
      data: {
        played: { increment: 1 },
        wins: { increment: isWin ? 1 : 0 },
        draws: { increment: isDraw ? 1 : 0 },
        losses: { increment: !isWin && !isDraw ? 1 : 0 },
        scoreFor: { increment: scored },
        scoreAgainst: { increment: conceded },
        points: {
          increment: isWin ? tournament.pointsWin : isDraw ? tournament.pointsDraw : tournament.pointsLoss,
        },
      },
    });
  }

  private async payMatch(
    tx: Prisma.TransactionClient,
    tournament: Tournament,
    homeTeamId: string,
    awayTeamId: string,
    homeScore: number,
    awayScore: number,
    matchId: string,
  ) {
    const isDraw = homeScore === awayScore;
    const winnerTeamId = isDraw ? null : homeScore > awayScore ? homeTeamId : awayTeamId;
    const loserTeamId = isDraw ? null : homeScore > awayScore ? awayTeamId : homeTeamId;

    if (isDraw) {
      await this.payTeam(tx, tournament, homeTeamId, tournament.coinsDraw, WalletTxType.MATCH_DRAW, 'Empate', matchId);
      await this.payTeam(tx, tournament, awayTeamId, tournament.coinsDraw, WalletTxType.MATCH_DRAW, 'Empate', matchId);
      return;
    }

    await this.payTeam(tx, tournament, winnerTeamId!, tournament.coinsWin, WalletTxType.MATCH_WIN, 'Vitória', matchId);
    await this.payTeam(tx, tournament, loserTeamId!, tournament.coinsLoss, WalletTxType.MATCH_LOSS, 'Participação', matchId);
  }

  private async payTeam(
    tx: Prisma.TransactionClient,
    tournament: Tournament,
    teamId: string,
    amount: number,
    type: WalletTxType,
    label: string,
    referenceId: string,
  ) {
    if (amount <= 0) return;
    const userIds = await this.teamUserIds(tx, teamId);
    for (const userId of userIds) {
      await this.wallet.credit(
        {
          userId,
          amount,
          type,
          description: `${label} em ${tournament.name}`,
          referenceType: 'tournamentMatch',
          referenceId,
        },
        tx,
      );
    }
  }

  private async teamUserIds(tx: Prisma.TransactionClient, teamId: string): Promise<number[]> {
    const members = await tx.tournamentTeamMember.findMany({ where: { teamId }, select: { userId: true } });
    if (members.length > 0) return members.map((member) => member.userId);

    const team = await tx.tournamentTeam.findUnique({ where: { id: teamId }, select: { ownerDiscordId: true } });
    if (!team?.ownerDiscordId) return [];
    const owner = await tx.user.findUnique({ where: { discordId: team.ownerDiscordId }, select: { id: true } });
    return owner ? [owner.id] : [];
  }

  private async qualifyFromGroups(tx: Prisma.TransactionClient, tournament: Tournament) {
    const groups = await tx.tournamentGroup.findMany({
      where: { tournamentId: tournament.id },
      orderBy: { order: 'asc' },
    });
    if (groups.length === 0) return;

    const openGroupMatches = await tx.tournamentMatch.count({
      where: { tournamentId: tournament.id, phase: TournamentPhase.GROUP, status: { in: OPEN_STATUSES } },
    });
    if (openGroupMatches > 0) return;

    const firstKnockout = await tx.tournamentMatch.findFirst({
      where: { tournamentId: tournament.id, phase: TournamentPhase.WINNERS, round: 1 },
    });
    if (!firstKnockout || firstKnockout.homeTeamId || firstKnockout.awayTeamId) return;

    const teams = await tx.tournamentTeam.findMany({
      where: { tournamentId: tournament.id, groupId: { not: null } },
      select: { id: true, groupId: true, name: true, points: true, scoreFor: true, scoreAgainst: true },
    });
    const standings = groups.map((group) =>
      teams
        .filter((team) => team.groupId === group.id)
        .sort(compareStandings)
        .map((team) => team.id),
    );

    const qualifiers = orderGroupQualifiers(standings, tournament.advancePerGroup);
    const slots = seedSlots(bracketSizeFor(qualifiers.length));
    const roundOne = await tx.tournamentMatch.findMany({
      where: { tournamentId: tournament.id, phase: TournamentPhase.WINNERS, round: 1 },
      orderBy: { position: 'asc' },
    });

    for (const match of roundOne) {
      const home = qualifiers[slots[match.position * 2] - 1];
      const away = qualifiers[slots[match.position * 2 + 1] - 1];
      if (home) await placeTeam(tx, match.id, 'HOME', home.teamId);
      if (away) await placeTeam(tx, match.id, 'AWAY', away.teamId);
    }

    const nonQualified = await tx.tournamentTeam.findMany({
      where: { tournamentId: tournament.id, id: { notIn: qualifiers.map((entry) => entry.teamId) } },
      select: { id: true },
    });
    await tx.tournamentTeam.updateMany({
      where: { id: { in: nonQualified.map((team) => team.id) } },
      data: { eliminated: true },
    });

    await resolveWalkovers(tx, tournament.id);
  }

  private async maybeFinish(tx: Prisma.TransactionClient, tournament: Tournament) {
    const open = await tx.tournamentMatch.count({
      where: { tournamentId: tournament.id, status: { in: OPEN_STATUSES } },
    });
    if (open > 0) return;

    const decider =
      (await tx.tournamentMatch.findFirst({
        where: { tournamentId: tournament.id, phase: TournamentPhase.GRAND_FINAL, winnerTeamId: { not: null } },
      })) ??
      (await tx.tournamentMatch.findFirst({
        where: { tournamentId: tournament.id, phase: TournamentPhase.WINNERS, winnerTeamId: { not: null } },
        orderBy: { round: 'desc' },
      }));

    let championTeamId = decider?.winnerTeamId ?? null;
    let runnerUpTeamId = decider
      ? decider.homeTeamId === decider.winnerTeamId
        ? decider.awayTeamId
        : decider.homeTeamId
      : null;

    if (!championTeamId) {
      const table = await tx.tournamentTeam.findMany({
        where: { tournamentId: tournament.id },
        orderBy: [{ points: 'desc' }, { scoreFor: 'desc' }, { scoreAgainst: 'asc' }],
        take: 2,
        select: { id: true },
      });
      championTeamId = table[0]?.id ?? null;
      runnerUpTeamId = table[1]?.id ?? null;
    }

    await tx.tournament.update({
      where: { id: tournament.id },
      data: {
        status: TournamentStatus.FINISHED,
        finishedAt: new Date(),
        championTeamId,
        runnerUpTeamId,
      },
    });

    if (championTeamId) {
      await this.payTeam(
        tx,
        tournament,
        championTeamId,
        tournament.coinsChampion,
        WalletTxType.TOURNAMENT_PRIZE,
        'Campeão',
        tournament.id,
      );
    }
    if (runnerUpTeamId) {
      await this.payTeam(
        tx,
        tournament,
        runnerUpTeamId,
        tournament.coinsRunnerUp,
        WalletTxType.TOURNAMENT_PRIZE,
        'Vice-campeão',
        tournament.id,
      );
    }
  }
}
