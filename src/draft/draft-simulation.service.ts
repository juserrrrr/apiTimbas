import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DraftLeague,
  DraftLeagueStatus,
  DraftMatch,
  DraftMatchStatus,
  DraftPlayer,
  DraftResultMode,
  DraftRoster,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SimPlayer, SimSide, autoLineup, simulateMatch } from '../football/match-simulation';
import { DraftFixtureService } from './draft-fixture.service';

@Injectable()
export class DraftSimulationService {
  private readonly logger = new Logger(DraftSimulationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fixtures: DraftFixtureService,
  ) {}

  /// Roda de cinco em cinco minutos e só age quando a rodada chegou na hora
  /// marcada, então quem manda no calendário são os dias e a hora da liga.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick() {
    await this.syncMarketWindows();
    await this.playDueMatches();
  }

  async playDueMatches() {
    const leagues = await this.prisma.draftLeague.findMany({
      where: { status: DraftLeagueStatus.ACTIVE, resultMode: DraftResultMode.SIMULATED },
    });

    for (const league of leagues) {
      const due = await this.prisma.draftMatch.findMany({
        where: {
          leagueId: league.id,
          status: { not: DraftMatchStatus.FINISHED },
          scheduledAt: { lte: new Date() },
        },
        orderBy: [{ round: 'asc' }, { scheduledAt: 'asc' }],
      });

      for (const match of due) {
        try {
          await this.playMatch(league, match);
        } catch (error) {
          this.logger.warn(`Falha ao simular a partida ${match.id}: ${(error as Error).message}`);
        }
      }
    }
  }

  /// Simula uma partida específica, o que o moderador também pode disparar na mão
  /// quando quer adiantar a rodada.
  async playOne(leagueId: string, matchId: string) {
    const league = await this.prisma.draftLeague.findUnique({ where: { id: leagueId } });
    if (!league) throw new NotFoundException('Liga não encontrada.');
    const match = await this.prisma.draftMatch.findFirst({ where: { id: matchId, leagueId } });
    if (!match) throw new NotFoundException('Rodada não encontrada nesta liga.');
    return this.playMatch(league, match);
  }

  private async playMatch(league: DraftLeague, match: DraftMatch) {
    const [home, away] = await Promise.all([
      this.buildSide(league, match.homeRosterId),
      this.buildSide(league, match.awayRosterId),
    ]);

    const result = simulateMatch(home, away, match.id);
    await this.fixtures.settleSimulated(match.id, result);

    this.logger.log(
      `${league.name} rodada ${match.round}: ${result.homeScore} x ${result.awayScore} (${result.summary})`,
    );
    return result;
  }

  private async buildSide(league: DraftLeague, rosterId: string): Promise<SimSide> {
    const roster = await this.prisma.draftRoster.findUniqueOrThrow({
      where: { id: rosterId },
      include: { players: true },
    });

    return {
      players: this.lineupOf(roster, league.rosterSize),
      mentality: roster.mentality,
      pressing: roster.pressing,
      tempo: roster.tempo,
    };
  }

  /// Escalação do treinador quando existe, senão o time entra com o que o elenco
  /// tem de melhor: rodada não deixa de acontecer porque ninguém escalou.
  private lineupOf(roster: DraftRoster & { players: DraftPlayer[] }, rosterSize: number): SimPlayer[] {
    const size = Math.min(11, Math.max(1, rosterSize));
    const starters = roster.players.filter((player) => player.starter);
    const chosen = starters.length > 0 ? starters.slice(0, size) : autoLineup(roster.players.map(toSimPlayer), size);
    return chosen.map(toSimPlayer);
  }

  private async syncMarketWindows() {
    const leagues = await this.prisma.draftLeague.findMany({
      where: { status: DraftLeagueStatus.ACTIVE, marketAutoManaged: true },
    });

    for (const league of leagues) {
      const next = await this.prisma.draftMatch.findFirst({
        where: { leagueId: league.id, status: { not: DraftMatchStatus.FINISHED } },
        orderBy: { scheduledAt: 'asc' },
        select: { scheduledAt: true },
      });

      const closing = next
        ? next.scheduledAt.getTime() - Date.now() <= league.marketClosesMinutesBefore * 60_000
        : false;
      if (league.transferWindowOpen === !closing) continue;

      await this.prisma.draftLeague.update({
        where: { id: league.id },
        data: { transferWindowOpen: !closing },
      });
      this.logger.log(`Mercado da ${league.name} ${closing ? 'fechado para a rodada' : 'reaberto'}.`);
    }
  }
}

function toSimPlayer(player: DraftPlayer | SimPlayer): SimPlayer {
  return {
    id: player.id,
    position: player.position,
    overall: player.overall,
    pace: player.pace,
    shooting: player.shooting,
    passing: player.passing,
    dribbling: player.dribbling,
    defending: player.defending,
    physical: player.physical,
    form: player.form,
  };
}
