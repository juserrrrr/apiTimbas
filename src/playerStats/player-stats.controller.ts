import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ClashScoutRateLimitGuard } from '../clash/guards/clash-scout-rate-limit.guard';
import { PlayerStatsService } from './player-stats.service';
import { PermissionGuard, RequirePermissions } from '../access/permission.guard';
import { RequireFeature } from '../decorators/feature.decorator';
import { FEATURE_DASHBOARD_CLASH, FEATURE_DASHBOARD_LOL_PROFILE } from '../feature-flags/feature-flags.constants';
import { FeatureFlagGuard } from '../feature-flags/guards/feature-flag.guard';

@UseGuards(AuthGuard, FeatureFlagGuard, PermissionGuard)
@RequireFeature(FEATURE_DASHBOARD_CLASH, FEATURE_DASHBOARD_LOL_PROFILE)
@RequirePermissions('dashboard.clash', 'dashboard.lol.profile')
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
