import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClashScoutRateLimitGuard } from '../clash/guards/clash-scout-rate-limit.guard';
import { RiotModule } from '../riot/riot.module';
import { PlayerStatsController } from './player-stats.controller';
import { PlayerStatsService } from './player-stats.service';

@Module({
  imports: [AuthModule, RiotModule],
  controllers: [PlayerStatsController],
  providers: [PlayerStatsService, ClashScoutRateLimitGuard],
  exports: [PlayerStatsService],
})
export class PlayerStatsModule {}
