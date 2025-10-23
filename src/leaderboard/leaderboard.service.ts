import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordServerService } from '../discordServer/discordServer.service';

export interface PlayerStats {
  rank: number;
  userId: number;
  name: string;
  discordId: string;
  score: number;
  wins: number;
  losses: number;
  totalGames: number;
  winRate: number;
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
          prs.wins,
          prs.losses,
          prs."totalGames",
          -- Balanced Score: ( (wins * 2) - losses ) * winRate * 10 (rounded)
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

    const leaderboard = results.map((player, index) => {
      const winRate =
        player.totalGames > 0 ? player.wins / player.totalGames : 0;

      return {
        rank: index + 1,
        userId: player.userId,
        name: player.name,
        discordId: player.discordId,
        wins: player.wins,
        losses: player.losses,
        score: player.score,
        totalGames: player.totalGames,
        winRate: parseFloat(winRate.toFixed(2)),
      };
    });

    return leaderboard;
  }
}
