import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { WalletService } from './wallet.service';
import { SeasonService } from './season.service';
import { AchievementService } from './achievement.service';
import { PostMatchService } from './post-match.service';

@Module({
  imports: [PrismaModule, AiModule],
  providers: [WalletService, SeasonService, AchievementService, PostMatchService],
  exports: [WalletService, SeasonService, AchievementService, PostMatchService],
})
export class EngagementModule {}
