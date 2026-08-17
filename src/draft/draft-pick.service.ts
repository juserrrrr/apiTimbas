import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DraftLeague, DraftLeagueStatus, DraftMatchStatus, DraftStartMode, Prisma } from '@prisma/client';
import { Actor } from '../common/actor.service';
import { PrismaService } from '../prisma/prisma.service';
import { DraftAccessService } from './draft-access.service';
import { DraftBudgetService } from './draft-budget.service';
import { nextMatchDates, pickCoordinate, roundRobinPairs } from './draft-order';

@Injectable()
export class DraftPickService {
  private readonly logger = new Logger(DraftPickService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DraftAccessService,
    private readonly budget: DraftBudgetService,
  ) {}

  /// Sala de espera do draft ao vivo: cada dono marca presença e, quando o último
  /// marca, o draft abre sozinho. Vaga aberta não precisa marcar, porque não tem
  /// ninguém para chegar.
  async setReady(leagueId: string, ready: boolean, actor: Actor) {
    const league = await this.access.requireLeague(leagueId);
    if (league.status !== DraftLeagueStatus.SETUP) {
      throw new BadRequestException('O draft desta liga já começou.');
    }
    const roster = await this.access.requireRoster(leagueId, actor);

    await this.prisma.draftRoster.update({
      where: { id: roster.id },
      data: { readyAt: ready ? new Date() : null },
    });

    const room = await this.waitingRoom(leagueId);
    if (league.startMode === DraftStartMode.LIVE && room.everyoneReady && room.canOpen) {
      await this.openDraft(league, true);
      return { ...(await this.waitingRoom(leagueId)), started: true };
    }
    return { ...room, started: false };
  }

  /// Quem já está pronto, quem falta e se o pool aguenta. É o que a sala mostra.
  async waitingRoom(leagueId: string) {
    const league = await this.access.requireLeague(leagueId);
    const [rosters, freeAgents] = await Promise.all([
      this.prisma.draftRoster.findMany({
        where: { leagueId },
        orderBy: { draftOrder: 'asc' },
        select: {
          id: true,
          name: true,
          userId: true,
          readyAt: true,
          user: { select: { id: true, name: true, avatar: true } },
        },
      }),
      this.prisma.draftPlayer.count({ where: { leagueId, rosterId: null } }),
    ]);

    const owned = rosters.filter((roster) => roster.userId !== null);
    const needed = rosters.length * league.rosterSize;
    const timeArrived = !league.draftStartsAt || league.draftStartsAt.getTime() <= Date.now();

    return {
      startMode: league.startMode,
      draftStartsAt: league.draftStartsAt,
      rosters,
      readyCount: owned.filter((roster) => roster.readyAt !== null).length,
      ownedCount: owned.length,
      vacantCount: rosters.length - owned.length,
      everyoneReady: owned.length > 0 && owned.every((roster) => roster.readyAt !== null),
      poolNeeded: needed,
      poolAvailable: freeAgents,
      canOpen: rosters.length >= 2 && freeAgents >= needed && timeArrived,
      waitingForTime: !timeArrived,
    };
  }

  /// Na hora marcada, se todo mundo já deu pronto, o draft abre sem ninguém
  /// precisar clicar de novo.
  @Cron(CronExpression.EVERY_MINUTE)
  async openScheduledDrafts() {
    const leagues = await this.prisma.draftLeague.findMany({
      where: {
        status: DraftLeagueStatus.SETUP,
        startMode: DraftStartMode.LIVE,
        draftStartsAt: { not: null, lte: new Date() },
      },
    });

    for (const league of leagues) {
      try {
        const room = await this.waitingRoom(league.id);
        if (!room.everyoneReady || !room.canOpen) continue;
        await this.openDraft(league, true);
        this.logger.log(`Draft da ${league.name} abriu na hora marcada, com todos prontos.`);
      } catch (error) {
        this.logger.warn(`Falha ao abrir o draft da liga ${league.id}: ${(error as Error).message}`);
      }
    }
  }

  async startDraft(leagueId: string, actor: Actor, shuffle: boolean, force = false) {
    await this.access.requireManage(leagueId, actor);
    const league = await this.access.requireLeague(leagueId);
    if (league.status !== DraftLeagueStatus.SETUP) {
      throw new BadRequestException('Esta liga já passou da fase de montagem.');
    }

    // No ao vivo, quem não deu pronto ainda pode estar chegando: só o dono da liga
    // atropela isso, e conscientemente.
    if (league.startMode === DraftStartMode.LIVE && !force) {
      const room = await this.waitingRoom(leagueId);
      const missing = room.rosters.filter((roster) => roster.userId !== null && roster.readyAt === null);
      if (missing.length > 0) {
        throw new BadRequestException(
          `Faltam ${missing.length} time(s) dar pronto: ${missing.map((roster) => roster.name).join(', ')}.`,
        );
      }
      if (room.waitingForTime) {
        throw new BadRequestException('O draft está marcado para mais tarde. Comece na mão se quiser adiantar.');
      }
    }

    return this.openDraft(league, shuffle);
  }

  private async openDraft(league: DraftLeague, shuffle: boolean) {
    const leagueId = league.id;

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
        await tx.draftRoster.update({
          where: { id: roster.id },
          data: { draftOrder: index + 1, readyAt: null },
        });
      }
      // Dinheiro é da temporada: começar o draft zera e reparte o caixa de novo.
      await this.budget.seed(leagueId, league.startingBudget, tx);
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

  /// Time vago escolhe na hora, sem esperar o cronômetro: senão a vaga trava o
  /// draft de quem apareceu.
  async autoPickExpired() {
    const leagues = await this.prisma.draftLeague.findMany({
      where: { status: DraftLeagueStatus.DRAFTING },
    });

    for (const league of leagues) {
      try {
        const rosters = await this.orderedRosters(league.id);
        const onTheClock = this.onTheClock(league, rosters);
        if (!onTheClock) continue;

        const expired = (league.pickDeadline?.getTime() ?? Infinity) < Date.now();
        if (!expired && onTheClock.userId !== null) continue;

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
      select: { id: true, name: true, draftOrder: true, userId: true },
    });
  }

  private onTheClock(league: DraftLeague, rosters: Array<{ id: string; name: string; userId?: number | null }>) {
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
