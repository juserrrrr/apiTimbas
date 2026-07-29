import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { SeasonService } from './season.service';
import { AchievementService } from './achievement.service';
import { PostMatchService } from './post-match.service';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';

@Module({
  imports: [PrismaModule, AiModule, LeaderboardModule],
  providers: [SeasonService, AchievementService, PostMatchService],
  exports: [SeasonService, AchievementService, PostMatchService],
})
export class EngagementModule {}
