import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScoreReaderModule } from '../score-reader/score-reader.module';
import { DraftAccessService } from './draft-access.service';
import { DraftAuctionService } from './draft-auction.service';
import { DraftBudgetService } from './draft-budget.service';
import { DraftController } from './draft.controller';
import { DraftFixtureService } from './draft-fixture.service';
import { DraftMarketService } from './draft-market.service';
import { DraftPickService } from './draft-pick.service';
import { DraftSimulationService } from './draft-simulation.service';
import { DraftService } from './draft.service';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [PrismaModule, AuthModule, ScoreReaderModule, AccessModule, FeatureFlagsModule],
  controllers: [DraftController],
  providers: [
    DraftService,
    DraftPickService,
    DraftMarketService,
    DraftFixtureService,
    DraftSimulationService,
    DraftBudgetService,
    DraftAuctionService,
    DraftAccessService,
  ],
  exports: [DraftPickService, DraftFixtureService, DraftSimulationService],
})
export class DraftModule {}
