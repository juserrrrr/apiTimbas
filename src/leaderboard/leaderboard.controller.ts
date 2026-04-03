import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { AuthGuard } from '../auth/guards/auth.guard';

@UseGuards(AuthGuard)
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get(':discordServerId')
  async getLeaderboard(
    @Param('discordServerId') discordServerId: string,
    @Query('mode') mode?: string,
  ) {
    const playersPerTeam = mode ? parseInt(mode, 10) : undefined;
    return this.leaderboardService.getLeaderboardForServer(discordServerId, playersPerTeam);
  }

  @Get(':discordServerId/matches')
  async getMatchHistory(
    @Param('discordServerId') discordServerId: string,
    @Query('mode') mode?: string,
  ) {
    const playersPerTeam = mode ? parseInt(mode, 10) : undefined;
    return this.leaderboardService.getMatchHistoryForServer(discordServerId, playersPerTeam);
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
}
