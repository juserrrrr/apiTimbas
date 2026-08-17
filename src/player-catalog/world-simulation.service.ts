import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CatalogCompetition,
  CatalogPlayer,
  DraftLeagueStatus,
  TacticIntensity,
  TacticMentality,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { overallFromAttributes } from '../football/attributes';
import { applyChange, attributeChange, nextForm, nextRatingAvg } from '../football/development';
import { SimPlayer, autoLineup, simulateMatch } from '../football/match-simulation';

const TICK_INTERVAL_HOURS = 24;
const MIN_SQUAD = 7;
const LINEUP_SIZE = 11;

@Injectable()
export class WorldSimulationService {
  private readonly logger = new Logger(WorldSimulationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /// A base não fica parada esperando alguém escalar: cada competição joga uma
  /// rodada por dia, e é dela que sai a nota, a forma e a evolução de quem não
  /// está em nenhuma liga nossa.
  @Cron(CronExpression.EVERY_HOUR)
  async tick() {
    const cutoff = new Date(Date.now() - TICK_INTERVAL_HOURS * 60 * 60 * 1000);
    const competitions = await this.prisma.catalogCompetition.findMany({
      where: {
        simulationEnabled: true,
        OR: [{ lastWorldTickAt: null }, { lastWorldTickAt: { lt: cutoff } }],
      },
    });

    for (const competition of competitions) {
      try {
        const played = await this.playRound(competition);
        this.logger.log(`${competition.name}: rodada ${competition.worldRound + 1} com ${played} partida(s).`);
      } catch (error) {
        this.logger.warn(`Falha na rodada da base de ${competition.name}: ${(error as Error).message}`);
      }
    }
  }

  async playRound(competition: CatalogCompetition): Promise<number> {
    const teams = await this.prisma.catalogTeam.findMany({
      where: { competitionId: competition.id },
      include: { players: { where: { active: true } } },
      orderBy: { name: 'asc' },
    });

    const busy = await this.rosteredPlayerIds(teams.flatMap((team) => team.players.map((player) => player.id)));
    const eligible = teams
      .map((team) => ({
        id: team.id,
        name: team.name,
        players: team.players.filter((player) => !busy.has(player.id)),
      }))
      .filter((team) => team.players.length >= MIN_SQUAD);

    const round = competition.worldRound + 1;
    const pairs = pairTeams(eligible, `${competition.id}-${round}`);

    for (const [home, away] of pairs) {
      const result = simulateMatch(
        { players: autoLineup(home.players.map(toSimPlayer), LINEUP_SIZE), ...NEUTRAL_TACTICS },
        { players: autoLineup(away.players.map(toSimPlayer), LINEUP_SIZE), ...NEUTRAL_TACTICS },
        `${competition.id}-${round}-${home.id}`,
      );

      const byId = new Map([...home.players, ...away.players].map((player) => [player.id, player]));
      await this.prisma.$transaction(async (tx) => {
        for (const performance of result.performances) {
          const player = byId.get(performance.playerId);
          if (!player) continue;
          await tx.catalogPlayer.update({
            where: { id: player.id },
            data: this.progressOf(player, performance.rating),
          });
        }
      });
    }

    await this.prisma.catalogCompetition.update({
      where: { id: competition.id },
      data: { worldRound: round, lastWorldTickAt: new Date() },
    });

    return pairs.length;
  }

  private progressOf(player: CatalogPlayer, rating: number) {
    const now = new Date();
    const ratingAvg = nextRatingAvg(player.ratingAvg, player.matchesPlayed, rating);
    const change = attributeChange(
      {
        position: player.position,
        birthDate: player.birthDate,
        form: player.form,
        ratingAvg,
        matchesPlayed: player.matchesPlayed + 1,
        attributes: player,
      },
      (rating * 137) % 1,
      now,
    );
    const attributes = change ? applyChange(player, change) : null;

    return {
      matchesPlayed: { increment: 1 },
      ratingAvg,
      lastRating: rating,
      form: nextForm(player.form, rating),
      lastPlayedAt: now,
      ...(attributes ? { ...attributes, overall: overallFromAttributes(player.position, attributes) } : {}),
    };
  }

  /// Quem foi escolhido numa liga nossa está jogando por ela, então não joga
  /// também pelo time de origem.
  private async rosteredPlayerIds(catalogPlayerIds: string[]): Promise<Set<string>> {
    if (catalogPlayerIds.length === 0) return new Set();
    const rostered = await this.prisma.draftPlayer.findMany({
      where: {
        catalogPlayerId: { in: catalogPlayerIds },
        rosterId: { not: null },
        league: { status: { in: [DraftLeagueStatus.DRAFTING, DraftLeagueStatus.ACTIVE] } },
      },
      select: { catalogPlayerId: true },
    });
    return new Set(rostered.map((player) => player.catalogPlayerId!));
  }
}

const NEUTRAL_TACTICS = {
  mentality: TacticMentality.BALANCED,
  pressing: TacticIntensity.MEDIUM,
  tempo: TacticIntensity.MEDIUM,
};

interface WorldTeam {
  id: string;
  name: string;
  players: CatalogPlayer[];
}

/// Sorteio com semente da rodada: os confrontos mudam a cada rodada e são os
/// mesmos se a rodada rodar de novo.
function pairTeams(teams: WorldTeam[], seed: string): Array<[WorldTeam, WorldTeam]> {
  const shuffled = [...teams];
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0;
  }

  for (let index = shuffled.length - 1; index > 0; index--) {
    hash = (Math.imul(hash, 48271) + 11) >>> 0;
    const swap = hash % (index + 1);
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }

  const pairs: Array<[WorldTeam, WorldTeam]> = [];
  for (let index = 0; index + 1 < shuffled.length; index += 2) {
    pairs.push([shuffled[index], shuffled[index + 1]]);
  }
  return pairs;
}

function toSimPlayer(player: CatalogPlayer): SimPlayer {
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
