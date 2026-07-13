import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UnlockedAchievement {
  userId: number;
  discordId: string;
  name: string;
  type: string;
  label: string;
  emoji: string;
}

interface AchievementDef {
  type: string;
  label: string;
  emoji: string;
  test: (stats: { wins: number; totalGames: number; winStreak: number }) => boolean;
}

const ACHIEVEMENTS: AchievementDef[] = [
  { type: 'STREAK_3',  emoji: '🔥', label: '3 vitórias seguidas — está esquentando!',        test: (s) => s.winStreak >= 3 },
  { type: 'STREAK_5',  emoji: '🔥', label: '5 vitórias seguidas — EM CHAMAS!',               test: (s) => s.winStreak >= 5 },
  { type: 'STREAK_10', emoji: '💀', label: '10 vitórias seguidas — LENDÁRIO!',               test: (s) => s.winStreak >= 10 },
  { type: 'WINS_10',   emoji: '🏅', label: '10 vitórias no servidor',                        test: (s) => s.wins >= 10 },
  { type: 'WINS_25',   emoji: '🥉', label: '25 vitórias no servidor',                        test: (s) => s.wins >= 25 },
  { type: 'WINS_50',   emoji: '🥈', label: '50 vitórias no servidor',                        test: (s) => s.wins >= 50 },
  { type: 'WINS_100',  emoji: '🥇', label: '100 vitórias no servidor',                       test: (s) => s.wins >= 100 },
  { type: 'GAMES_25',  emoji: '🎮', label: '25 partidas jogadas',                            test: (s) => s.totalGames >= 25 },
  { type: 'GAMES_50',  emoji: '🎮', label: '50 partidas jogadas',                            test: (s) => s.totalGames >= 50 },
  { type: 'GAMES_100', emoji: '🕹️', label: '100 partidas jogadas — veterano!',               test: (s) => s.totalGames >= 100 },
  { type: 'GAMES_250', emoji: '👴', label: '250 partidas jogadas — morador do custom!',      test: (s) => s.totalGames >= 250 },
];

@Injectable()
export class AchievementService {
  private readonly logger = new Logger(AchievementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verifica conquistas dos jogadores após uma partida e retorna apenas as
   * desbloqueadas agora (idempotente via unique serverId+userId+type).
   */
  async checkAndUnlock(
    serverId: string,
    players: { userId: number; discordId: string; name: string }[],
  ): Promise<UnlockedAchievement[]> {
    const unlocked: UnlockedAchievement[] = [];

    for (const player of players) {
      try {
        const stats = await this.getPlayerStats(serverId, player.userId);
        const already = new Set(
          (await this.prisma.achievement.findMany({
            where: { serverId, userId: player.userId },
            select: { type: true },
          })).map((a) => a.type),
        );

        for (const def of ACHIEVEMENTS) {
          if (already.has(def.type) || !def.test(stats)) continue;
          try {
            await this.prisma.achievement.create({
              data: { serverId, userId: player.userId, type: def.type },
            });
            unlocked.push({ ...player, type: def.type, label: def.label, emoji: def.emoji });
          } catch {
            // corrida com outro finish — conquista já registrada
          }
        }
      } catch (e) {
        this.logger.warn(`Falha ao checar conquistas do user ${player.userId}: ${e}`);
      }
    }

    return unlocked;
  }

  private async getPlayerStats(serverId: string, userId: number) {
    const matches = await this.prisma.customLeagueMatch.findMany({
      where: {
        ServerDiscordId: serverId,
        winnerId: { not: null },
        Teams: { some: { players: { some: { userId } } } },
      },
      include: { Teams: { include: { players: { where: { userId } } } } },
      orderBy: { dateCreated: 'desc' },
    });

    let wins = 0;
    let winStreak = 0;
    let streakOpen = true;
    for (const match of matches) {
      const myTeam = match.Teams.find((t) => t.players.length > 0);
      if (!myTeam) continue;
      const won = match.winnerId === myTeam.id;
      if (won) wins++;
      if (streakOpen) {
        if (won) winStreak++;
        else streakOpen = false;
      }
    }

    return { wins, totalGames: matches.length, winStreak };
  }
}
