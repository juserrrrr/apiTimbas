import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScoreReaderModule } from '../score-reader/score-reader.module';
import { DraftAccessService } from './draft-access.service';
import { DraftBudgetService } from './draft-budget.service';
import { DraftController } from './draft.controller';
import { DraftFixtureService } from './draft-fixture.service';
import { DraftMarketService } from './draft-market.service';
import { DraftPickService } from './draft-pick.service';
import { DraftSimulationService } from './draft-simulation.service';
import { DraftService } from './draft.service';

@Module({
  imports: [PrismaModule, AuthModule, ScoreReaderModule],
  controllers: [DraftController],
  providers: [
    DraftService,
    DraftPickService,
    DraftMarketService,
    DraftFixtureService,
    DraftSimulationService,
    DraftBudgetService,
    DraftAccessService,
  ],
  exports: [DraftPickService, DraftFixtureService, DraftSimulationService],
})
export class DraftModule {}
