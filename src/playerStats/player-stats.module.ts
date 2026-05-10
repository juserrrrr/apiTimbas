import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { ClashScoutRateLimitGuard } from '../clash/guards/clash-scout-rate-limit.guard';
import { RiotModule } from '../riot/riot.module';
import { PlayerStatsController } from './player-stats.controller';
import { PlayerStatsService } from './player-stats.service';

@Module({
  imports: [AuthModule, RiotModule, AiModule],
  controllers: [PlayerStatsController],
  providers: [PlayerStatsService, ClashScoutRateLimitGuard],
  exports: [PlayerStatsService],
})
export class PlayerStatsModule {}
