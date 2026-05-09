import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ClashScoutRateLimitGuard } from '../clash/guards/clash-scout-rate-limit.guard';
import { PlayerStatsService } from './player-stats.service';

@UseGuards(AuthGuard)
@Controller('player-stats')
export class PlayerStatsController {
  constructor(private readonly playerStatsService: PlayerStatsService) {}

  @Get('riot')
  @UseGuards(ClashScoutRateLimitGuard)
  async riot(
    @Query('gameName') gameName: string,
    @Query('tagLine') tagLine: string,
  ) {
    if (!gameName || !tagLine) throw new BadRequestException('gameName e tagLine são obrigatórios');
    return this.playerStatsService.getRiotPlayer(gameName, tagLine);
  }
}
