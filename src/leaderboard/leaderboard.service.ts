import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PlayerStats {
  rank: number;
  userId: number;
  name: string;
  discordId: string;
  wins: number;
  losses: number;
  totalGames: number;
  winRate: number;
}

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getLeaderboardForServer(discordServerId: string): Promise<PlayerStats[]> {
    const serverExists = await this.prisma.discordServer.findUnique({
      where: { discordServerId },
    });

    if (!serverExists) {
      throw new NotFoundException(
        `Servidor com ID ${discordServerId} não encontrado.`,
      );
    }

    const results: any[] = await this.prisma.$queryRaw`
      SELECT
          u.id AS "userId",
          u.name,
          u."discordId",
          CAST(COUNT(CASE WHEN ctm."winnerId" = tl.id THEN 1 END) AS INTEGER) AS wins,
          CAST(COUNT(CASE WHEN ctm."winnerId" IS NOT NULL AND ctm."winnerId" != tl.id THEN 1 END) AS INTEGER) AS losses
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
      ORDER BY
          wins DESC,
          (CAST(COUNT(CASE WHEN ctm."winnerId" = tl.id THEN 1 END) AS REAL) / COUNT(*)) DESC,
          COUNT(*) DESC;
    `;

    const leaderboard = results.map((player, index) => {
      const totalGames = player.wins + player.losses;
      const winRate = totalGames > 0 ? player.wins / totalGames : 0;

      return {
        rank: index + 1,
        userId: player.userId,
        name: player.name,
        discordId: player.discordId,
        wins: player.wins,
        losses: player.losses,
        totalGames: totalGames,
        winRate: parseFloat(winRate.toFixed(2)), // Arredonda para 2 casas decimais
      };
    });

    return leaderboard;
  }
}
