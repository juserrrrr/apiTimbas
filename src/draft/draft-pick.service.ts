import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DraftLeague, DraftLeagueStatus, DraftMatchStatus, Prisma } from '@prisma/client';
import { Actor } from '../common/actor.service';
import { PrismaService } from '../prisma/prisma.service';
import { DraftAccessService } from './draft-access.service';
import { nextMatchDates, pickCoordinate, roundRobinPairs } from './draft-order';

@Injectable()
export class DraftPickService {
  private readonly logger = new Logger(DraftPickService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DraftAccessService,
  ) {}

  async startDraft(leagueId: string, actor: Actor, shuffle: boolean) {
    await this.access.requireManage(leagueId, actor);
    const league = await this.access.requireLeague(leagueId);
    if (league.status !== DraftLeagueStatus.SETUP) {
      throw new BadRequestException('Esta liga já passou da fase de montagem.');
    }

    const [rosters, freeAgents] = await Promise.all([
      this.prisma.draftRoster.findMany({ where: { leagueId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.draftPlayer.count({ where: { leagueId, rosterId: null } }),
    ]);

    if (rosters.length < 2) throw new BadRequestException('A liga precisa de ao menos 2 elencos.');
    const needed = rosters.length * league.rosterSize;
    if (freeAgents < needed) {
      throw new BadRequestException(
        `São necessários ${needed} jogadores no pool (${rosters.length} elencos x ${league.rosterSize}); há ${freeAgents}.`,
      );
    }

    const ordered = shuffle ? shuffleArray(rosters) : rosters;

    return this.prisma.$transaction(async (tx) => {
      for (const [index, roster] of ordered.entries()) {
        await tx.draftRoster.update({ where: { id: roster.id }, data: { draftOrder: index + 1 } });
      }
      return tx.draftLeague.update({
        where: { id: leagueId },
        data: {
          status: DraftLeagueStatus.DRAFTING,
          currentPickNumber: 0,
          currentRound: 1,
          startedAt: new Date(),
          pickDeadline: new Date(Date.now() + league.pickSeconds * 1000),
        },
      });
    });
  }

  async pick(leagueId: string, playerId: string, actor: Actor, forcedRosterId?: string) {
    const access = await this.access.of(leagueId, actor);
    const league = await this.access.requireLeague(leagueId);
    if (league.status !== DraftLeagueStatus.DRAFTING) {
      throw new BadRequestException('O draft desta liga não está aberto.');
    }

    const rosters = await this.orderedRosters(leagueId);
    const onTheClock = this.onTheClock(league, rosters);
    if (!onTheClock) throw new BadRequestException('O draft já acabou.');

    const targetRosterId = forcedRosterId && access.canModerate ? forcedRosterId : access.rosterId;
    if (targetRosterId !== onTheClock.id) {
      throw new ForbiddenException(`Agora é a vez de ${onTheClock.name}.`);
    }

    return this.commitPick(league, onTheClock.id, playerId, false);
  }

  async autoPickExpired() {
    const leagues = await this.prisma.draftLeague.findMany({
      where: { status: DraftLeagueStatus.DRAFTING, pickDeadline: { lt: new Date() } },
    });

    for (const league of leagues) {
      try {
        const rosters = await this.orderedRosters(league.id);
        const onTheClock = this.onTheClock(league, rosters);
        if (!onTheClock) continue;

        const best = await this.prisma.draftPlayer.findFirst({
          where: { leagueId: league.id, rosterId: null },
          orderBy: [{ overall: 'desc' }, { name: 'asc' }],
        });
        if (!best) continue;

        await this.commitPick(league, onTheClock.id, best.id, true);
        this.logger.log(`Escolha automática: ${best.name} para ${onTheClock.name} (${league.name}).`);
      } catch (error) {
        this.logger.warn(`Falha na escolha automática da liga ${league.id}: ${(error as Error).message}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  handleExpiredPicks() {
    return this.autoPickExpired();
  }

  private async commitPick(league: DraftLeague, rosterId: string, playerId: string, auto: boolean) {
    const rosterCount = await this.prisma.draftRoster.count({ where: { leagueId: league.id } });
    const totalPicks = rosterCount * league.rosterSize;

    return this.prisma.$transaction(
      async (tx) => {
        const player = await tx.draftPlayer.findFirst({ where: { id: playerId, leagueId: league.id } });
        if (!player) throw new NotFoundException('Jogador não encontrado nesta liga.');
        if (player.rosterId) throw new BadRequestException('Esse jogador já foi escolhido.');

        const owned = await tx.draftPlayer.count({ where: { rosterId } });
        if (owned >= league.rosterSize) {
          throw new BadRequestException('Este elenco já está completo.');
        }

        const current = pickCoordinate(league.currentPickNumber, rosterCount, league.orderType);
        await tx.draftPick.create({
          data: {
            leagueId: league.id,
            rosterId,
            playerId,
            round: current.round,
            pickNumber: league.currentPickNumber,
            price: player.price,
            auto,
          },
        });
        await tx.draftPlayer.update({ where: { id: playerId }, data: { rosterId } });

        const nextPickNumber = league.currentPickNumber + 1;
        const finished = nextPickNumber >= totalPicks;
        const updated = await tx.draftLeague.update({
          where: { id: league.id },
          data: {
            currentPickNumber: nextPickNumber,
            currentRound: finished ? current.round : pickCoordinate(nextPickNumber, rosterCount, league.orderType).round,
            pickDeadline: finished ? null : new Date(Date.now() + league.pickSeconds * 1000),
            status: finished ? DraftLeagueStatus.ACTIVE : DraftLeagueStatus.DRAFTING,
          },
        });

        if (finished) await this.generateFixtures(tx, updated);
        return { pick: current, player, league: updated };
      },
      { timeout: 30000 },
    );
  }

  async generateFixtures(tx: Prisma.TransactionClient, league: DraftLeague) {
    const rosters = await tx.draftRoster.findMany({
      where: { leagueId: league.id },
      orderBy: { draftOrder: 'asc' },
      select: { id: true },
    });

    const pairs = roundRobinPairs(rosters.length);
    const totalRounds = Math.max(...pairs.map((pair) => pair.round), 0);
    const dates = nextMatchDates(new Date(), league.matchDays, league.matchHour, totalRounds);

    await tx.draftMatch.deleteMany({ where: { leagueId: league.id } });
    await tx.draftMatch.createMany({
      data: pairs.map((pair) => ({
        leagueId: league.id,
        round: pair.round,
        homeRosterId: rosters[pair.home].id,
        awayRosterId: rosters[pair.away].id,
        scheduledAt: dates[pair.round - 1],
        status: DraftMatchStatus.SCHEDULED,
      })),
    });

    await tx.draftLeague.update({
      where: { id: league.id },
      data: { totalRounds, currentRound: 1 },
    });
  }

  private async orderedRosters(leagueId: string) {
    return this.prisma.draftRoster.findMany({
      where: { leagueId },
      orderBy: { draftOrder: 'asc' },
      select: { id: true, name: true, draftOrder: true },
    });
  }

  private onTheClock(league: DraftLeague, rosters: Array<{ id: string; name: string }>) {
    if (rosters.length === 0) return null;
    if (league.currentPickNumber >= rosters.length * league.rosterSize) return null;
    const current = pickCoordinate(league.currentPickNumber, rosters.length, league.orderType);
    return rosters[current.rosterIndex] ?? null;
  }
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}
