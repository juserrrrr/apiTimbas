import { BadRequestException, Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { GameMode } from '@prisma/client';
import { LeaderboardService } from './leaderboard.service';
import { AuthGuard } from '../auth/guards/auth.guard';

@UseGuards(AuthGuard)
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  /**
   * Ausente = geral. Valor inválido vira erro em vez de virar geral em
   * silêncio, senão um filtro com typo devolveria o ranking errado.
   */
  private parseGameModeFilter(gameMode?: string): GameMode | undefined {
    if (!gameMode) return undefined;
    if (!Object.values(GameMode).includes(gameMode as GameMode)) {
      throw new BadRequestException(`Modo de jogo inválido: ${gameMode}`);
    }
    return gameMode as GameMode;
  }

  @Get(':discordServerId')
  async getLeaderboard(
    @Param('discordServerId') discordServerId: string,
    @Query('mode') mode?: string,
    @Query('gameMode') gameMode?: string,
  ) {
    const playersPerTeam = mode ? parseInt(mode, 10) : undefined;
    return this.leaderboardService.getLeaderboardForServer(
      discordServerId,
      playersPerTeam,
      this.parseGameModeFilter(gameMode),
    );
  }

  @Get(':discordServerId/matches')
  async getMatchHistory(
    @Param('discordServerId') discordServerId: string,
    @Query('mode') mode?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const playersPerTeam = mode ? parseInt(mode, 10) : undefined;
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.leaderboardService.getMatchHistoryForServer(discordServerId, playersPerTeam, pageNum, limitNum);
  }

  @Get(':discordServerId/player/:userId')
  async getPlayerStats(
    @Param('discordServerId') discordServerId: string,
    @Param('userId', ParseIntPipe) userId: number,
    @Query('mode') mode?: string,
  ) {
    const playersPerTeam = mode ? parseInt(mode, 10) : undefined;
    return this.leaderboardService.getPlayerDetailStats(discordServerId, userId, playersPerTeam);
  }

  @Get(':discordServerId/player/:userId/duo')
  async getDuoStats(
    @Param('discordServerId') discordServerId: string,
    @Param('userId', ParseIntPipe) userId: number,
    @Query('mode') mode?: string,
  ) {
    const playersPerTeam = mode ? parseInt(mode, 10) : undefined;
    return this.leaderboardService.getDuoStats(discordServerId, userId, playersPerTeam);
  }
}
