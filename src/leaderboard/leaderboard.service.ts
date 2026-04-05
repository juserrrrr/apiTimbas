import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PlayerStats {
  rank: number;
  userId: number;
  name: string;
  discordId: string;
  avatar: string | null;
  score: number;
  wins: number;
  losses: number;
  totalGames: number;
  winRate: number;
}

export interface PositionStat {
  position: string;
  wins: number;
  losses: number;
  total: number;
  winRate: number;
}

export interface MatchTypeStat {
  type: string;
  label: string;
  wins: number;
  losses: number;
  total: number;
  winRate: number;
}

export interface PlayerDetailStats {
  currentStreakCount: number;
  currentStreakType: 'W' | 'L' | null;
  longestWinStreak: number;
  recentForm: ('W' | 'L')[];
  blueSide: { wins: number; losses: number; total: number; winRate: number };
  redSide: { wins: number; losses: number; total: number; winRate: number };
  weeklyPerformance: { week: string; wins: number; losses: number }[];
  positionStats: PositionStat[];
  matchTypeStats: MatchTypeStat[];
}

export interface DuoStat {
  userId: number;
  name: string;
  discordId: string;
  avatar: string | null;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
}

export interface DuoStats {
  partners: DuoStat[];
  opponents: DuoStat[];
}

export interface MatchHistoryEntry {
  id: number;
  matchType: string;
  playersPerTeam: number;
  dateCreated: Date;
  winnerId: number | null;
  blueTeam: { id: number; players: { userId: number; name: string; discordId: string; avatar: string | null; position: string | null }[] };
  redTeam: { id: number; players: { userId: number; name: string; discordId: string; avatar: string | null; position: string | null }[] };
}

export interface PaginatedMatches {
  data: MatchHistoryEntry[];
  total: number;
  page: number;
  pages: number;
  hasNext: boolean;
}

const MATCH_TYPE_LABELS: Record<string, string> = {
  ALEATORIO: 'Aleatório',
  LIVRE: 'Livre',
  BALANCEADO: 'Balanceado',
  ALEATORIO_COMPLETO: 'Aleat. Completo',
};

const CACHE_TTL = 5 * 60 * 1000;

@Injectable()
export class LeaderboardService {
  private readonly cache = new Map<string, { data: unknown; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  private fromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.data as T;
    this.cache.delete(key);
    return null;
  }

  private toCache(key: string, data: unknown): void {
    this.cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
  }

  async getLeaderboardForServer(
    discordServerId: string,
    playersPerTeam?: number,
  ): Promise<PlayerStats[]> {
    const cacheKey = `leaderboard:${discordServerId}:${playersPerTeam ?? 'all'}`;
    const cached = this.fromCache<PlayerStats[]>(cacheKey);
    if (cached) return cached;

    const modeFilter = playersPerTeam
      ? Prisma.sql`AND ctm."playersPerTeam" = ${playersPerTeam}`
      : Prisma.sql``;

    const results: any[] = await this.prisma.$queryRaw`
      WITH "PlayerRawStats" AS (
        SELECT
            u.id AS "userId",
            CAST(COUNT(CASE WHEN ctm."winnerId" = tl.id THEN 1 END) AS INT) AS wins,
            CAST(COUNT(CASE WHEN ctm."winnerId" IS NOT NULL AND ctm."winnerId" != tl.id THEN 1 END) AS INT) AS losses,
            CAST(COUNT(ctm.id) AS INT) AS "totalGames"
        FROM
            "User" u
        JOIN "UserTeamLeague" utl ON u.id = utl."userId"
        JOIN "TeamLeague" tl ON utl."teamLeagueId" = tl.id
        JOIN "CustomLeagueMatch" ctm ON tl."customLeagueMatchId" = ctm.id
        WHERE
            ctm."ServerDiscordId" = ${discordServerId}
            AND ctm."winnerId" IS NOT NULL
            ${modeFilter}
        GROUP BY
            u.id
      )
      SELECT
          prs."userId",
          u.name,
          u."discordId",
          u.avatar,
          prs.wins,
          prs.losses,
          prs."totalGames",
          ROUND(
            (CAST(prs.wins AS REAL) / NULLIF(prs."totalGames", 0)) * 100
            + (prs.wins * 2)
            - (prs.losses)
          ) AS score
      FROM
          "PlayerRawStats" prs
      JOIN
          "User" u ON prs."userId" = u.id
      WHERE
          prs."totalGames" > 0
      ORDER BY
          score DESC,
          wins DESC,
          "totalGames" DESC,
          u.name ASC;
    `;

    const data = results.map((player, index) => {
      const winRate = player.totalGames > 0 ? player.wins / player.totalGames : 0;
      return {
        rank: index + 1,
        userId: player.userId,
        name: player.name,
        discordId: player.discordId,
        avatar: player.avatar ?? null,
        wins: player.wins,
        losses: player.losses,
        score: player.score,
        totalGames: player.totalGames,
        winRate: parseFloat(winRate.toFixed(2)),
      };
    });

    this.toCache(cacheKey, data);
    return data;
  }

  async getPlayerDetailStats(
    discordServerId: string,
    userId: number,
    playersPerTeam?: number,
  ): Promise<PlayerDetailStats> {
    const cacheKey = `player:${discordServerId}:${userId}:${playersPerTeam ?? 'all'}`;
    const cached = this.fromCache<PlayerDetailStats>(cacheKey);
    if (cached) return cached;

    const matches = await this.prisma.customLeagueMatch.findMany({
      where: {
        ServerDiscordId: discordServerId,
        winnerId: { not: null },
        ...(playersPerTeam ? { playersPerTeam } : {}),
        Teams: { some: { players: { some: { userId } } } },
      },
      include: {
        Teams: {
          include: { players: { where: { userId } } },
        },
      },
      orderBy: { dateCreated: 'desc' },
    });

    const matchResults = matches
      .map((match) => {
        const playerTeam = match.Teams.find((t) => t.players.length > 0);
        if (!playerTeam) return null;
        return {
          won: match.winnerId === playerTeam.id,
          side: playerTeam.side,
          date: match.dateCreated,
          position: playerTeam.players[0]?.position ?? null,
          matchType: match.matchType,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Streak
    let currentStreakCount = 0;
    let currentStreakType: 'W' | 'L' | null = null;
    for (const result of matchResults) {
      if (currentStreakType === null) {
        currentStreakType = result.won ? 'W' : 'L';
        currentStreakCount = 1;
      } else if ((result.won && currentStreakType === 'W') || (!result.won && currentStreakType === 'L')) {
        currentStreakCount++;
      } else {
        break;
      }
    }

    let longestWinStreak = 0;
    let tempStreak = 0;
    for (const result of [...matchResults].reverse()) {
      if (result.won) {
        tempStreak++;
        if (tempStreak > longestWinStreak) longestWinStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    }

    const recentForm: ('W' | 'L')[] = matchResults.slice(0, 10).map((r) => (r.won ? 'W' : 'L'));

    // Side stats
    const blueSideMatches = matchResults.filter((r) => r.side === 'BLUE');
    const redSideMatches = matchResults.filter((r) => r.side === 'RED');
    const blueSideWins = blueSideMatches.filter((r) => r.won).length;
    const redSideWins = redSideMatches.filter((r) => r.won).length;

    // Weekly performance
    const weeklyMap = new Map<string, { week: string; wins: number; losses: number }>();
    for (const result of matchResults) {
      const d = new Date(result.date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff));
      monday.setHours(0, 0, 0, 0);
      const key = monday.toISOString().split('T')[0];
      if (!weeklyMap.has(key)) weeklyMap.set(key, { week: key, wins: 0, losses: 0 });
      const entry = weeklyMap.get(key)!;
      if (result.won) entry.wins++;
      else entry.losses++;
    }
    const weeklyPerformance = [...weeklyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([, v]) => v);

    // Position stats
    const positionMap = new Map<string, { wins: number; losses: number }>();
    for (const result of matchResults) {
      if (!result.position) continue;
      if (!positionMap.has(result.position)) positionMap.set(result.position, { wins: 0, losses: 0 });
      const entry = positionMap.get(result.position)!;
      if (result.won) entry.wins++;
      else entry.losses++;
    }
    const positionStats: PositionStat[] = [...positionMap.entries()]
      .map(([position, s]) => ({
        position,
        wins: s.wins,
        losses: s.losses,
        total: s.wins + s.losses,
        winRate: (s.wins + s.losses) > 0 ? parseFloat((s.wins / (s.wins + s.losses)).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.winRate - a.winRate);

    // Match type stats
    const matchTypeMap = new Map<string, { wins: number; losses: number }>();
    for (const result of matchResults) {
      if (!matchTypeMap.has(result.matchType)) matchTypeMap.set(result.matchType, { wins: 0, losses: 0 });
      const entry = matchTypeMap.get(result.matchType)!;
      if (result.won) entry.wins++;
      else entry.losses++;
    }
    const matchTypeStats: MatchTypeStat[] = [...matchTypeMap.entries()]
      .map(([type, s]) => ({
        type,
        label: MATCH_TYPE_LABELS[type] ?? type,
        wins: s.wins,
        losses: s.losses,
        total: s.wins + s.losses,
        winRate: (s.wins + s.losses) > 0 ? parseFloat((s.wins / (s.wins + s.losses)).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.winRate - a.winRate);

    const data: PlayerDetailStats = {
      currentStreakCount,
      currentStreakType,
      longestWinStreak,
      recentForm,
      blueSide: {
        wins: blueSideWins,
        losses: blueSideMatches.length - blueSideWins,
        total: blueSideMatches.length,
        winRate: blueSideMatches.length > 0 ? parseFloat((blueSideWins / blueSideMatches.length).toFixed(2)) : 0,
      },
      redSide: {
        wins: redSideWins,
        losses: redSideMatches.length - redSideWins,
        total: redSideMatches.length,
        winRate: redSideMatches.length > 0 ? parseFloat((redSideWins / redSideMatches.length).toFixed(2)) : 0,
      },
      weeklyPerformance,
      positionStats,
      matchTypeStats,
    };

    this.toCache(cacheKey, data);
    return data;
  }

  async getDuoStats(
    discordServerId: string,
    userId: number,
    playersPerTeam?: number,
  ): Promise<DuoStats> {
    const cacheKey = `duo:${discordServerId}:${userId}:${playersPerTeam ?? 'all'}`;
    const cached = this.fromCache<DuoStats>(cacheKey);
    if (cached) return cached;

    const matches = await this.prisma.customLeagueMatch.findMany({
      where: {
        ServerDiscordId: discordServerId,
        winnerId: { not: null },
        ...(playersPerTeam ? { playersPerTeam } : {}),
        Teams: { some: { players: { some: { userId } } } },
      },
      include: {
        Teams: {
          include: {
            players: {
              include: { user: { select: { id: true, name: true, discordId: true, avatar: true } } },
            },
          },
        },
      },
    });

    const partnerMap = new Map<number, { name: string; discordId: string; avatar: string | null; wins: number; games: number }>();
    const opponentMap = new Map<number, { name: string; discordId: string; avatar: string | null; wins: number; games: number }>();

    for (const match of matches) {
      const myTeam = match.Teams.find((t) => t.players.some((p) => p.userId === userId));
      const enemyTeam = match.Teams.find((t) => t.id !== myTeam?.id);
      if (!myTeam) continue;
      const won = match.winnerId === myTeam.id;

      for (const player of myTeam.players) {
        if (player.userId === userId) continue;
        if (!partnerMap.has(player.userId)) {
          partnerMap.set(player.userId, { name: player.user.name, discordId: player.user.discordId, avatar: player.user.avatar ?? null, wins: 0, games: 0 });
        }
        const entry = partnerMap.get(player.userId)!;
        entry.games++;
        if (won) entry.wins++;
      }

      if (enemyTeam) {
        for (const player of enemyTeam.players) {
          if (!opponentMap.has(player.userId)) {
            opponentMap.set(player.userId, { name: player.user.name, discordId: player.user.discordId, avatar: player.user.avatar ?? null, wins: 0, games: 0 });
          }
          const entry = opponentMap.get(player.userId)!;
          entry.games++;
          if (won) entry.wins++;
        }
      }
    }

    const toStat = (id: number, d: { name: string; discordId: string; avatar: string | null; wins: number; games: number }): DuoStat => ({
      userId: id,
      name: d.name,
      discordId: d.discordId,
      avatar: d.avatar,
      games: d.games,
      wins: d.wins,
      losses: d.games - d.wins,
      winRate: d.games > 0 ? parseFloat((d.wins / d.games).toFixed(2)) : 0,
    });

    const data: DuoStats = {
      partners: [...partnerMap.entries()].map(([id, d]) => toStat(id, d)).sort((a, b) => b.winRate - a.winRate || b.wins - a.wins),
      opponents: [...opponentMap.entries()].map(([id, d]) => toStat(id, d)).sort((a, b) => b.games - a.games),
    };

    this.toCache(cacheKey, data);
    return data;
  }

  async getMatchHistoryForServer(
    discordServerId: string,
    playersPerTeam?: number,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedMatches> {
    const cacheKey = `history:${discordServerId}:${playersPerTeam ?? 'all'}`;
    let allMatches = this.fromCache<MatchHistoryEntry[]>(cacheKey);

    if (!allMatches) {
      const matches = await this.prisma.customLeagueMatch.findMany({
        where: {
          ServerDiscordId: discordServerId,
          status: 'FINISHED',
          ...(playersPerTeam ? { playersPerTeam } : {}),
        },
        include: {
          Teams: {
            include: {
              players: {
                include: { user: { select: { id: true, name: true, discordId: true, avatar: true } } },
              },
            },
          },
        },
        orderBy: { dateCreated: 'desc' },
      });

      allMatches = matches.map((match) => {
        const blueTeamRaw = match.Teams.find((t) => t.side === 'BLUE');
        const redTeamRaw = match.Teams.find((t) => t.side === 'RED');

        const mapPlayers = (team: typeof blueTeamRaw) =>
          team
            ? team.players.map((p) => ({
                userId: p.user.id,
                name: p.user.name,
                discordId: p.user.discordId,
                avatar: p.user.avatar ?? null,
                position: p.position,
              }))
            : [];

        return {
          id: match.id,
          matchType: match.matchType,
          playersPerTeam: match.playersPerTeam,
          dateCreated: match.dateCreated,
          winnerId: match.winnerId,
          blueTeam: { id: blueTeamRaw?.id ?? 0, players: mapPlayers(blueTeamRaw) },
          redTeam: { id: redTeamRaw?.id ?? 0, players: mapPlayers(redTeamRaw) },
        };
      });

      this.toCache(cacheKey, allMatches);
    }

    const total = allMatches.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(Math.max(1, page), pages);
    const start = (safePage - 1) * limit;

    return {
      data: allMatches.slice(start, start + limit),
      total,
      page: safePage,
      pages,
      hasNext: safePage < pages,
    };
  }
}
