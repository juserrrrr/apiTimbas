import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordServerService } from '../discordServer/discordServer.service';

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

export interface PlayerDetailStats {
  currentStreakCount: number;
  currentStreakType: 'W' | 'L' | null;
  longestWinStreak: number;
  recentForm: ('W' | 'L')[];
  blueSide: { wins: number; losses: number; total: number; winRate: number };
  redSide: { wins: number; losses: number; total: number; winRate: number };
  weeklyPerformance: { week: string; wins: number; losses: number }[];
}

export interface MatchHistoryEntry {
  id: number;
  matchType: string;
  dateCreated: Date;
  winnerId: number | null;
  blueTeam: { id: number; players: { userId: number; name: string; discordId: string; avatar: string | null; position: string | null }[] };
  redTeam: { id: number; players: { userId: number; name: string; discordId: string; avatar: string | null; position: string | null }[] };
}

@Injectable()
export class LeaderboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discordServerService: DiscordServerService,
  ) {}

  async getLeaderboardForServer(
    discordServerId: string,
  ): Promise<PlayerStats[]> {
    await this.discordServerService.findOrCreate(discordServerId);

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

    return results.map((player, index) => {
      const winRate =
        player.totalGames > 0 ? player.wins / player.totalGames : 0;
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
  }

  async getPlayerDetailStats(
    discordServerId: string,
    userId: number,
  ): Promise<PlayerDetailStats> {
    await this.discordServerService.findOrCreate(discordServerId);

    const matches = await this.prisma.customLeagueMatch.findMany({
      where: {
        ServerDiscordId: discordServerId,
        winnerId: { not: null },
        Teams: {
          some: {
            players: { some: { userId } },
          },
        },
      },
      include: {
        Teams: {
          include: {
            players: {
              where: { userId },
            },
          },
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
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Current streak
    let currentStreakCount = 0;
    let currentStreakType: 'W' | 'L' | null = null;
    for (const result of matchResults) {
      if (currentStreakType === null) {
        currentStreakType = result.won ? 'W' : 'L';
        currentStreakCount = 1;
      } else if (
        (result.won && currentStreakType === 'W') ||
        (!result.won && currentStreakType === 'L')
      ) {
        currentStreakCount++;
      } else {
        break;
      }
    }

    // Longest win streak
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

    // Recent form (last 10)
    const recentForm: ('W' | 'L')[] = matchResults
      .slice(0, 10)
      .map((r) => (r.won ? 'W' : 'L'));

    // Side stats
    const blueSideMatches = matchResults.filter((r) => r.side === 'BLUE');
    const redSideMatches = matchResults.filter((r) => r.side === 'RED');
    const blueSideWins = blueSideMatches.filter((r) => r.won).length;
    const redSideWins = redSideMatches.filter((r) => r.won).length;

    // Weekly performance (last 8 weeks)
    const weeklyMap = new Map<string, { week: string; wins: number; losses: number }>();
    for (const result of matchResults) {
      const d = new Date(result.date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff));
      monday.setHours(0, 0, 0, 0);
      const key = monday.toISOString().split('T')[0];
      if (!weeklyMap.has(key)) {
        weeklyMap.set(key, { week: key, wins: 0, losses: 0 });
      }
      const entry = weeklyMap.get(key)!;
      if (result.won) entry.wins++;
      else entry.losses++;
    }

    const weeklyPerformance = [...weeklyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([, v]) => v);

    return {
      currentStreakCount,
      currentStreakType,
      longestWinStreak,
      recentForm,
      blueSide: {
        wins: blueSideWins,
        losses: blueSideMatches.length - blueSideWins,
        total: blueSideMatches.length,
        winRate:
          blueSideMatches.length > 0
            ? parseFloat((blueSideWins / blueSideMatches.length).toFixed(2))
            : 0,
      },
      redSide: {
        wins: redSideWins,
        losses: redSideMatches.length - redSideWins,
        total: redSideMatches.length,
        winRate:
          redSideMatches.length > 0
            ? parseFloat((redSideWins / redSideMatches.length).toFixed(2))
            : 0,
      },
      weeklyPerformance,
    };
  }

  async getMatchHistoryForServer(
    discordServerId: string,
  ): Promise<MatchHistoryEntry[]> {
    await this.discordServerService.findOrCreate(discordServerId);

    const matches = await this.prisma.customLeagueMatch.findMany({
      where: { ServerDiscordId: discordServerId },
      include: {
        Teams: {
          include: {
            players: {
              include: {
                user: {
                  select: { id: true, name: true, discordId: true, avatar: true },
                },
              },
            },
          },
        },
      },
      orderBy: { dateCreated: 'desc' },
    });

    return matches.map((match) => {
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
        dateCreated: match.dateCreated,
        winnerId: match.winnerId,
        blueTeam: {
          id: blueTeamRaw?.id ?? 0,
          players: mapPlayers(blueTeamRaw),
        },
        redTeam: {
          id: redTeamRaw?.id ?? 0,
          players: mapPlayers(redTeamRaw),
        },
      };
    });
  }
}
