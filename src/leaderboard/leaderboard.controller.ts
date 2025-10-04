import { Controller, Get, Param, UseGuards } from '@nestjs/common';
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
}
