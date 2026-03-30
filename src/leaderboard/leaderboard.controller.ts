import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { AuthGuard } from '../auth/guards/auth.guard';

@UseGuards(AuthGuard)
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get(':discordServerId')
  async getLeaderboard(@Param('discordServerId') discordServerId: string) {
    return this.leaderboardService.getLeaderboardForServer(discordServerId);
  }

  @Get(':discordServerId/matches')
  async getMatchHistory(@Param('discordServerId') discordServerId: string) {
    return this.leaderboardService.getMatchHistoryForServer(discordServerId);
  }

  @Get(':discordServerId/player/:userId')
  async getPlayerStats(
    @Param('discordServerId') discordServerId: string,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.leaderboardService.getPlayerDetailStats(discordServerId, userId);
  }
}
