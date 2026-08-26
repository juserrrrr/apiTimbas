import { Module } from '@nestjs/common';
import { ClashService } from './clash.service';
import { ScoutQueueService } from './scout-queue.service';
import { ClashController } from './clash.controller';
import { RiotModule } from '../riot/riot.module';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { ClashScoutRateLimitGuard } from './guards/clash-scout-rate-limit.guard';
import { PlayerStatsModule } from '../playerStats/player-stats.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessModule } from '../access/access.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
@Module({
  imports: [RiotModule, AiModule, AuthModule, PlayerStatsModule, PrismaModule, AccessModule, FeatureFlagsModule],
  controllers: [ClashController],
  providers: [ClashService, ScoutQueueService, ClashScoutRateLimitGuard],
})
export class ClashModule {}
