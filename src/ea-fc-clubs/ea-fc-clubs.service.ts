import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EaClubMatchResult, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateEaClubDto,
  SearchEaClubsDto,
  ValidateEaClubDto,
} from './dto/create-ea-club.dto';
import { EaLeaderboardQueryDto } from './dto/leaderboard-query.dto';
import { EaMatchQueryDto } from './dto/match-query.dto';
import { EaFcClubsProvider } from './ea-fc-clubs.provider';
import {
  EaClubMatch,
  EaFcClubNotFoundError,
  EaFcPayloadError,
  EaFcProviderError,
} from './ea-fc-clubs.types';

@Injectable()
export class EaFcClubsService {
  private readonly logger = new Logger(EaFcClubsService.name);
  private readonly defaultMinimumAppearances: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: EaFcClubsProvider,
    config: ConfigService,
  ) {
    this.defaultMinimumAppearances = Math.max(
      1,
      Number(config.get('EA_FC_LEADERBOARD_MIN_APPEARANCES') ?? 3),
    );
  }

  async validateClub(dto: ValidateEaClubDto) {
    return this.callProvider(() =>
      this.provider.getClub(dto.externalClubId, dto.platform),
    );
  }

  async searchClubs(dto: SearchEaClubsDto) {
    const clubs = await this.callProvider(() =>
      this.provider.searchClubs(dto.name.trim(), dto.platform),
    );
    return clubs.map((club) => ({
      externalClubId: club.externalId,
      name: club.name,
      platform: club.platform,
    }));
  }

  async resolveTournamentClub(name: string, platform: 'common-gen5') {
    const clubs = await this.callProvider(() => this.provider.searchClubs(name.trim(), platform));
    const normalized = name.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
    const exact = Array.from(new Map(
      clubs
        .filter((club) => club.name.normalize('NFKC').trim().toLocaleLowerCase('pt-BR') === normalized)
        .map((club) => [club.externalId, club]),
    ).values());
    if (exact.length === 0) throw new NotFoundException('Não encontramos um clube com esse nome exato na EA.');
    if (exact.length > 1) throw new BadGatewayException('A EA retornou mais de um clube com esse nome. Tente um nome mais específico.');
    return { externalClubId: exact[0].externalId, name: exact[0].name, platform: exact[0].platform };
  }

  async requireTournamentClub(externalClubId: string, platform: 'common-gen5') {
    const club = await this.callProvider(() => this.provider.getClub(externalClubId, platform));
    return { externalClubId: club.externalId, name: club.name, platform: club.platform };
  }

  async friendlyMatches(externalClubId: string, platform: 'common-gen5') {
    return this.callProvider(() => this.provider.getClubMatches(externalClubId, platform, {
      matchType: 'friendlyMatch',
      maxResultCount: 10,
    }));
  }

  async createClub(dto: CreateEaClubDto) {
    const external = await this.callProvider(() =>
      this.provider.getClub(dto.externalClubId, dto.platform),
    );
    return this.prisma.eaClub.upsert({
      where: {
        externalClubId_platform: {
          externalClubId: external.externalId,
          platform: dto.platform,
        },
      },
      update: { name: external.name, nickname: dto.nickname },
      create: {
        externalClubId: external.externalId,
        name: external.name,
        platform: dto.platform,
        nickname: dto.nickname,
      },
    });
  }

  listClubs() {
    return this.prisma.eaClub.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async syncAllClubs() {
    const clubs = await this.prisma.eaClub.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    const results: Array<{
      clubId: string;
      clubName: string;
      imported: number;
      failed: number;
      error?: string;
    }> = [];

    for (const club of clubs) {
      try {
        const result = await this.sync(club.id);
        results.push({
          clubId: club.id,
          clubName: club.name,
          imported: result.imported,
          failed: result.failed,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown synchronization error';
        this.logger.error(
          `Automatic EA FC sync failed for club ${club.id}: ${message}`,
        );
        results.push({
          clubId: club.id,
          clubName: club.name,
          imported: 0,
          failed: 1,
          error: message,
        });
      }
    }

    return results;
  }

  async getClub(id: string) {
    return this.requireClub(id);
  }

  async sync(id: string) {
    const club = await this.requireClub(id);
    const matches = await this.callProvider(() =>
      this.provider.getRecentMatches(
        club.externalClubId,
        club.platform as 'common-gen5',
      ),
    );
    const existing = new Set(
      (
        await this.prisma.eaClubMatch.findMany({
          where: {
            clubId: id,
            externalMatchId: {
              in: matches.map((match) => match.externalMatchId),
            },
          },
          select: { externalMatchId: true },
        })
      ).map((match) => match.externalMatchId),
    );

    let imported = 0;
    let skipped = existing.size;
    const errors: Array<{ externalMatchId: string; message: string }> = [];
    for (const match of matches) {
      if (existing.has(match.externalMatchId)) continue;
      try {
        const wasImported = await this.importMatch(club, match);
        if (wasImported) imported += 1;
        else skipped += 1;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          skipped += 1;
          continue;
        }
        this.logger.error(
          `Failed to import EA match ${match.externalMatchId}: ${(error as Error).message}`,
        );
        errors.push({
          externalMatchId: match.externalMatchId,
          message: 'Não foi possível importar esta partida.',
        });
      }
    }
    await this.refreshEaCareerTotals(club);
    const lastSyncAt = new Date();
    await this.prisma.eaClub.update({
      where: { id },
      data: { lastSyncAt },
    });
    return {
      imported,
      skipped,
      failed: errors.length,
      errors: errors.map(
        (error) => `${error.externalMatchId}: ${error.message}`,
      ),
      failureDetails: errors,
      lastSyncAt,
    };
  }

  async getDashboard(id: string) {
    const club = await this.requireClub(id);
    return {
      club,
      eaAllTimeStats:
        club.eaGamesPlayed === null && club.eaGoalsFor === null
          ? null
          : {
              gamesPlayed: club.eaGamesPlayed,
              wins: club.eaWins,
              draws: club.eaDraws,
              losses: club.eaLosses,
              goalsFor: club.eaGoalsFor,
              goalsAgainst: club.eaGoalsAgainst,
              updatedAt: club.eaStatsUpdatedAt,
            },
    };
  }

  async getMatches(id: string, query: EaMatchQueryDto) {
    await this.requireClub(id);
    const where: Prisma.EaClubMatchWhereInput = {
      clubId: id,
      result: query.result,
      opponentName: query.opponent
        ? { contains: query.opponent, mode: 'insensitive' }
        : undefined,
      playedAt:
        query.from || query.to
          ? {
              gte: query.from ? new Date(query.from) : undefined,
              ...(query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to)
                ? {
                    lt: new Date(
                      new Date(query.to).getTime() + 24 * 60 * 60 * 1000,
                    ),
                  }
                : { lte: query.to ? new Date(query.to) : undefined }),
            }
          : undefined,
      playerStats: query.playerId
        ? { some: { playerId: query.playerId } }
        : undefined,
    };
    const perPage = query.limit ?? query.perPage;
    const [items, total] = await Promise.all([
      this.prisma.eaClubMatch.findMany({
        where,
        orderBy: { playedAt: 'desc' },
        skip: (query.page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.eaClubMatch.count({ where }),
    ]);
    const pages = Math.ceil(total / perPage);
    return {
      data: items,
      items,
      total,
      page: query.page,
      pages,
      perPage,
    };
  }

  async getMatch(id: string, matchId: string) {
    const club = await this.requireClub(id);
    const match = await this.prisma.eaClubMatch.findFirst({
      where: { id: matchId, clubId: id },
      include: {
        playerStats: {
          include: { player: true },
          orderBy: [{ rating: 'desc' }, { goals: 'desc' }],
        },
      },
    });
    if (!match) throw new NotFoundException('Partida não encontrada.');
    const players = match.playerStats.map((stat) => ({
      ...stat,
      player: stat.player,
    }));
    return {
      ...match,
      club,
      players,
      homeClub: match.isHome
        ? {
            externalId: club.externalClubId,
            name: club.name,
            score: match.goalsFor,
          }
        : {
            externalId: match.opponentExternalId,
            name: match.opponentName,
            score: match.goalsAgainst,
          },
      awayClub: match.isHome
        ? {
            externalId: match.opponentExternalId,
            name: match.opponentName,
            score: match.goalsAgainst,
          }
        : {
            externalId: club.externalClubId,
            name: club.name,
            score: match.goalsFor,
          },
    };
  }

  async getPlayers(id: string) {
    await this.requireClub(id);
    const players = await this.prisma.eaClubPlayer.findMany({
      where: {
        clubId: id,
        OR: [{ matchStats: { some: {} } }, { eaClubGames: { not: null } }],
      },
      include: { _count: { select: { matchStats: true } } },
      orderBy: { playerName: 'asc' },
    });
    return players.map(({ _count, ...player }) => ({
      ...player,
      appearances: _count.matchStats,
    }));
  }

  async getPlayer(id: string, playerId: string) {
    await this.requireClub(id);
    const player = await this.prisma.eaClubPlayer.findFirst({
      where: { id: playerId, clubId: id },
      include: {
        matchStats: {
          select: {
            position: true,
            rating: true,
            goals: true,
            assists: true,
            passesAttempted: true,
            passesCompleted: true,
            tacklesAttempted: true,
            tacklesCompleted: true,
            saves: true,
            manOfTheMatch: true,
          },
        },
      },
    });
    if (!player) throw new NotFoundException('Jogador não encontrado.');
    const { matchStats, ...profile } = player;
    const grouped = new Map<
      string,
      {
        position: string;
        appearances: number;
        ratingSum: number;
        ratedMatches: number;
        goals: number;
        assists: number;
        passesAttempted: number;
        passesCompleted: number;
        tacklesAttempted: number;
        tacklesCompleted: number;
        saves: number;
        mvps: number;
      }
    >();

    for (const stat of matchStats) {
      const position = stat.position?.trim().toLocaleLowerCase('en-US');
      if (!position) continue;
      const row = grouped.get(position) ?? {
        position,
        appearances: 0,
        ratingSum: 0,
        ratedMatches: 0,
        goals: 0,
        assists: 0,
        passesAttempted: 0,
        passesCompleted: 0,
        tacklesAttempted: 0,
        tacklesCompleted: 0,
        saves: 0,
        mvps: 0,
      };
      row.appearances += 1;
      row.ratingSum += stat.rating ?? 0;
      row.ratedMatches += stat.rating === null ? 0 : 1;
      row.goals += stat.goals;
      row.assists += stat.assists;
      row.passesAttempted += stat.passesAttempted ?? 0;
      row.passesCompleted += stat.passesCompleted ?? 0;
      row.tacklesAttempted += stat.tacklesAttempted ?? 0;
      row.tacklesCompleted += stat.tacklesCompleted ?? 0;
      row.saves += stat.saves ?? 0;
      row.mvps += stat.manOfTheMatch ? 1 : 0;
      grouped.set(position, row);
    }

    const positionAnalysis = Array.from(grouped.values())
      .map((row) => ({
        position: row.position,
        appearances: row.appearances,
        averageRating:
          row.ratedMatches > 0 ? row.ratingSum / row.ratedMatches : null,
        goals: row.goals,
        assists: row.assists,
        goalContributions: row.goals + row.assists,
        passesCompleted: row.passesCompleted,
        passAccuracy:
          row.passesAttempted > 0
            ? (row.passesCompleted / row.passesAttempted) * 100
            : null,
        tacklesCompleted: row.tacklesCompleted,
        tackleAccuracy:
          row.tacklesAttempted > 0
            ? (row.tacklesCompleted / row.tacklesAttempted) * 100
            : null,
        saves: row.saves,
        mvps: row.mvps,
      }))
      .sort((a, b) => b.appearances - a.appearances);
    const eligiblePositions = positionAnalysis.filter(
      (position) =>
        position.appearances >= this.defaultMinimumAppearances &&
        position.averageRating !== null,
    );
    const bestPosition = [...eligiblePositions].sort(
      (a, b) =>
        Number(b.averageRating) - Number(a.averageRating) ||
        b.appearances - a.appearances,
    )[0];

    return {
      ...profile,
      positionAnalysis,
      mostPlayedPosition: positionAnalysis[0]?.position ?? null,
      bestPosition: bestPosition?.position ?? null,
      positionAnalysisMinimumAppearances: this.defaultMinimumAppearances,
    };
  }

  async getLeaderboard(id: string, query: EaLeaderboardQueryDto) {
    await this.requireClub(id);
    const minimumAppearances =
      query.minimumAppearances ?? this.defaultMinimumAppearances;
    const [stats, careerPlayers] = await Promise.all([
      this.prisma.eaMatchPlayerStat.findMany({
        where: { match: { clubId: id } },
        include: { player: { select: { id: true, playerName: true } } },
      }),
      this.prisma.eaClubPlayer.findMany({
        where: {
          clubId: id,
          eaClubGames: { not: null },
        },
        select: {
          id: true,
          playerName: true,
          eaClubGames: true,
          eaClubGoals: true,
          eaClubAssists: true,
          eaClubMvps: true,
          eaClubRating: true,
          eaClubPassesMade: true,
          eaClubPassSuccessRate: true,
          eaClubTacklesMade: true,
          eaClubTackleSuccessRate: true,
          eaClubShotSuccessRate: true,
          eaClubCleanSheetsDef: true,
          eaClubCleanSheetsGk: true,
          eaClubRedCards: true,
        },
      }),
    ]);
    const grouped = new Map<
      string,
      ReturnType<EaFcClubsService['emptyLeaderboardRow']>
    >();
    for (const stat of stats) {
      const row =
        grouped.get(stat.playerId) ??
        this.emptyLeaderboardRow(stat.player.id, stat.player.playerName);
      row.appearances += 1;
      row.goals += stat.goals;
      row.assists += stat.assists;
      row.goalContributions += stat.goals + stat.assists;
      row.ratingSum += stat.rating ?? 0;
      row.ratedMatches += stat.rating === null ? 0 : 1;
      row.mvps += stat.manOfTheMatch ? 1 : 0;
      row.passes += stat.passesCompleted ?? 0;
      row.tackles += stat.tacklesCompleted ?? 0;
      row.saves += stat.saves ?? 0;
      if (stat.position) {
        const position = stat.position.trim().toLocaleLowerCase('en-US');
        row.positions[position] = (row.positions[position] ?? 0) + 1;
      }
      grouped.set(stat.playerId, row);
    }
    const rows = Array.from(grouped.values()).map((row) => ({
      ...row,
      primaryPosition:
        Object.entries(row.positions).sort((a, b) => b[1] - a[1])[0]?.[0] ??
        null,
      averageRating:
        row.ratedMatches === 0 ? null : row.ratingSum / row.ratedMatches,
    }));
    const rank = (field: keyof (typeof rows)[number], eligible = rows) =>
      [...eligible]
        .sort((a, b) => Number(b[field] ?? -1) - Number(a[field] ?? -1))
        .map((row) => ({
          playerId: row.playerId,
          playerName: row.playerName,
          appearances: row.appearances,
          goals: row.goals,
          assists: row.assists,
          goalContributions: row.goalContributions,
          averageRating: row.averageRating,
          mvps: row.mvps,
          passes: row.passes,
          tackles: row.tackles,
          saves: row.saves,
          primaryPosition: row.primaryPosition,
        }));
    const topScorers = rank('goals');
    const assistRanking = rank('assists');
    const contributionRanking = rank('goalContributions');
    const ratingRanking = rank(
      'averageRating',
      rows.filter((row) => row.ratedMatches >= minimumAppearances),
    );
    const defenderRanking = rank(
      'averageRating',
      rows.filter(
        (row) =>
          row.primaryPosition === 'defender' &&
          row.ratedMatches >= minimumAppearances,
      ),
    );
    const mvpRanking = rank('mvps');
    const appearancesRanking = rank('appearances');
    const passesRanking = rank('passes');
    const tacklesRanking = rank('tackles');
    const savesRanking = rank('saves');
    const category = (
      key: string,
      label: string,
      field: keyof (typeof rows)[number],
      ranking: ReturnType<typeof rank>,
      minimumMatches?: number,
    ) => ({
      key,
      label,
      minimumMatches,
      entries: ranking
        .filter((row) => Number(row[field] ?? 0) > 0)
        .map((row) => ({
          player: { id: row.playerId, playerName: row.playerName },
          value: row[field],
          appearances: row.appearances,
        })),
    });
    const aggregateCategory = (
      key: string,
      label: string,
      field:
        | 'eaClubGames'
        | 'eaClubGoals'
        | 'eaClubAssists'
        | 'eaClubMvps'
        | 'eaClubRating'
        | 'eaClubPassesMade'
        | 'eaClubPassSuccessRate'
        | 'eaClubTacklesMade'
        | 'eaClubTackleSuccessRate'
        | 'eaClubShotSuccessRate'
        | 'eaClubCleanSheetsDef'
        | 'eaClubCleanSheetsGk'
        | 'eaClubRedCards',
    ) => ({
      key,
      label,
      source: 'EA_CLUB',
      entries: [...careerPlayers]
        .filter((player) => Number(player[field] ?? 0) > 0)
        .sort((a, b) => Number(b[field] ?? -1) - Number(a[field] ?? -1))
        .map((player) => ({
          player: { id: player.id, playerName: player.playerName },
          value: player[field] ?? 0,
          appearances: player.eaClubGames ?? undefined,
        })),
    });
    return {
      minimumAppearances,
      topScorers,
      assists: assistRanking,
      goalContributions: contributionRanking,
      averageRating: ratingRanking,
      defenders: defenderRanking,
      mvps: mvpRanking,
      appearances: appearancesRanking,
      passes: passesRanking,
      tackles: tacklesRanking,
      saves: savesRanking,
      categories: [
        aggregateCategory('eaClubGoals', 'No clube · Gols', 'eaClubGoals'),
        aggregateCategory(
          'eaClubAssists',
          'No clube · Assistências',
          'eaClubAssists',
        ),
        aggregateCategory('eaClubGames', 'No clube · Partidas', 'eaClubGames'),
        aggregateCategory(
          'eaClubPasses',
          'No clube · Passes certos',
          'eaClubPassesMade',
        ),
        aggregateCategory(
          'eaClubTackles',
          'No clube · Desarmes certos',
          'eaClubTacklesMade',
        ),
        aggregateCategory('eaClubRating', 'No clube · Nota', 'eaClubRating'),
        aggregateCategory('eaClubMvps', 'No clube · MVPs', 'eaClubMvps'),
        aggregateCategory(
          'eaClubPassAccuracy',
          'No clube · Precisão de passe',
          'eaClubPassSuccessRate',
        ),
        aggregateCategory(
          'eaClubTackleAccuracy',
          'No clube · Precisão de desarme',
          'eaClubTackleSuccessRate',
        ),
        aggregateCategory(
          'eaClubShotAccuracy',
          'No clube · Aproveitamento de chute',
          'eaClubShotSuccessRate',
        ),
        aggregateCategory(
          'eaClubCleanSheetsDef',
          'No clube · Clean sheets DEF',
          'eaClubCleanSheetsDef',
        ),
        aggregateCategory(
          'eaClubCleanSheetsGk',
          'No clube · Clean sheets GK',
          'eaClubCleanSheetsGk',
        ),
        category('goals', 'Artilheiros', 'goals', topScorers),
        category('assists', 'Assistências', 'assists', assistRanking),
        category(
          'goalContributions',
          'G+A',
          'goalContributions',
          contributionRanking,
        ),
        category(
          'averageRating',
          'Média de nota',
          'averageRating',
          ratingRanking,
          minimumAppearances,
        ),
        category(
          'defenders',
          'Melhores defensores',
          'averageRating',
          defenderRanking,
          minimumAppearances,
        ),
        category('mvps', 'MVPs', 'mvps', mvpRanking),
        category(
          'appearances',
          'Mais partidas',
          'appearances',
          appearancesRanking,
        ),
        category('passes', 'Passes', 'passes', passesRanking),
        category('tackles', 'Desarmes', 'tackles', tacklesRanking),
        category('saves', 'Defesas', 'saves', savesRanking),
      ],
    };
  }

  private async importMatch(
    club: { id: string; externalClubId: string },
    match: EaClubMatch,
  ): Promise<boolean> {
    const isHome = match.homeClubId === club.externalClubId;
    const isAway = match.awayClubId === club.externalClubId;
    if (!isHome && !isAway)
      throw new Error('Connected club is absent from match');
    const goalsFor = isHome ? match.homeScore : match.awayScore;
    const goalsAgainst = isHome ? match.awayScore : match.homeScore;
    const opponentExternalId = isHome ? match.awayClubId : match.homeClubId;
    const opponentName = isHome ? match.awayClubName : match.homeClubName;
    const players = match.playersByClub[club.externalClubId] ?? [];

    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.eaClubMatch.findUnique({
        where: {
          clubId_externalMatchId: {
            clubId: club.id,
            externalMatchId: match.externalMatchId,
          },
        },
        select: { id: true },
      });
      if (duplicate) return false;
      const created = await tx.eaClubMatch.create({
        data: {
          externalMatchId: match.externalMatchId,
          clubId: club.id,
          playedAt: match.playedAt,
          isHome,
          opponentExternalId,
          opponentName,
          goalsFor,
          goalsAgainst,
          result:
            goalsFor > goalsAgainst
              ? EaClubMatchResult.WIN
              : goalsFor < goalsAgainst
                ? EaClubMatchResult.LOSS
                : EaClubMatchResult.DRAW,
          rawData: match.rawData as Prisma.InputJsonValue,
        },
      });
      for (const stat of players) {
        const normalizedName = stat.playerName
          .normalize('NFKC')
          .trim()
          .toLocaleLowerCase('en-US');
        const identityKey = stat.externalPlayerId
          ? `ea:${stat.externalPlayerId}`
          : `anonymous:${match.externalMatchId}:${normalizedName}:${stat.position ?? ''}`;
        let player = await tx.eaClubPlayer.findUnique({
          where: { clubId_identityKey: { clubId: club.id, identityKey } },
        });
        if (!player && stat.externalPlayerId) {
          const aggregatePlayers = await tx.eaClubPlayer.findMany({
            where: {
              clubId: club.id,
              identityKey: {
                in: [`career:${normalizedName}`, `clubstats:${normalizedName}`],
              },
            },
          });
          if (aggregatePlayers.length === 1) {
            player = await tx.eaClubPlayer.update({
              where: { id: aggregatePlayers[0].id },
              data: {
                identityKey,
                externalPlayerId: stat.externalPlayerId,
                playerName: stat.playerName,
              },
            });
          }
        }
        player ??= await tx.eaClubPlayer.create({
          data: {
            clubId: club.id,
            externalPlayerId: stat.externalPlayerId,
            identityKey,
            playerName: stat.playerName,
          },
        });
        await tx.eaMatchPlayerStat.create({
          data: {
            matchId: created.id,
            playerId: player.id,
            position: stat.position,
            rating: stat.rating,
            goals: stat.goals,
            assists: stat.assists,
            shots: stat.shots,
            passesAttempted: stat.passesAttempted,
            passesCompleted: stat.passesCompleted,
            tacklesAttempted: stat.tacklesAttempted,
            tacklesCompleted: stat.tacklesCompleted,
            saves: stat.saves,
            manOfTheMatch: stat.manOfTheMatch,
          },
        });
      }
      return true;
    });
  }

  private async refreshEaCareerTotals(club: {
    id: string;
    externalClubId: string;
    platform: string;
  }) {
    const platform = club.platform as 'common-gen5';
    const updatedAt = new Date();

    try {
      const totals = await this.provider.getClubOverallStats(
        club.externalClubId,
        platform,
      );
      await this.prisma.eaClub.update({
        where: { id: club.id },
        data: {
          eaGamesPlayed: totals.gamesPlayed,
          eaWins: totals.wins,
          eaDraws: totals.draws,
          eaLosses: totals.losses,
          eaGoalsFor: totals.goalsFor,
          eaGoalsAgainst: totals.goalsAgainst,
          eaStatsUpdatedAt: updatedAt,
        },
      });
    } catch (error) {
      this.logger.warn(
        `EA overall totals unavailable for club ${club.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    try {
      const members = await this.provider.getClubMemberStats(
        club.externalClubId,
        platform,
      );
      const players = await this.prisma.eaClubPlayer.findMany({
        where: { clubId: club.id },
      });
      const byName = new Map<string, typeof players>();
      for (const player of players) {
        const key = this.normalizePlayerName(player.playerName);
        byName.set(key, [...(byName.get(key) ?? []), player]);
      }

      for (const member of members) {
        const key = this.normalizePlayerName(member.playerName);
        const matches = byName.get(key) ?? [];
        if (matches.length > 1) {
          this.logger.warn(
            `Skipped ambiguous EA club totals for ${member.playerName} in club ${club.id}`,
          );
          continue;
        }
        const data = {
          playerName: member.playerName,
          eaClubGames: member.gamesPlayed,
          eaClubGoals: member.goals,
          eaClubAssists: member.assists,
          eaClubMvps: member.manOfTheMatch,
          eaClubRating: member.averageRating,
          eaClubPassesMade: member.passesMade,
          eaClubPassSuccessRate: member.passSuccessRate,
          eaClubTacklesMade: member.tacklesMade,
          eaClubTackleSuccessRate: member.tackleSuccessRate,
          eaClubShotSuccessRate: member.shotSuccessRate,
          eaClubCleanSheetsDef: member.cleanSheetsDef,
          eaClubCleanSheetsGk: member.cleanSheetsGk,
          eaClubRedCards: member.redCards,
          eaClubStatsUpdatedAt: updatedAt,
        };
        if (matches[0]) {
          await this.prisma.eaClubPlayer.update({
            where: { id: matches[0].id },
            data,
          });
        } else {
          const player = await this.prisma.eaClubPlayer.create({
            data: {
              clubId: club.id,
              identityKey: `clubstats:${key}`,
              ...data,
            },
          });
          byName.set(key, [player]);
        }
      }
    } catch (error) {
      this.logger.warn(
        `EA member club totals unavailable for club ${club.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private normalizePlayerName(value: string) {
    return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  }

  private emptyLeaderboardRow(playerId: string, playerName: string) {
    return {
      playerId,
      playerName,
      appearances: 0,
      goals: 0,
      assists: 0,
      goalContributions: 0,
      ratingSum: 0,
      ratedMatches: 0,
      mvps: 0,
      passes: 0,
      tackles: 0,
      saves: 0,
      positions: {} as Record<string, number>,
    };
  }

  private async requireClub(id: string) {
    const club = await this.prisma.eaClub.findUnique({ where: { id } });
    if (!club) throw new NotFoundException('Clube EA FC não encontrado.');
    return club;
  }

  private async callProvider<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof EaFcClubNotFoundError) {
        throw new NotFoundException(
          'Não encontramos nenhum clube com esse Club ID.',
        );
      }
      if (error instanceof EaFcPayloadError) {
        this.logger.error(`Unexpected EA FC payload: ${error.message}`);
        throw new BadGatewayException(
          'A EA retornou dados em formato inesperado.',
        );
      }
      if (error instanceof EaFcProviderError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }
}
