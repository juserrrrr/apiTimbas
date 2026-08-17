import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AiModule } from '../ai/ai.module';
import { ScoreReaderModule } from '../score-reader/score-reader.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AttributeAiService } from './attribute-ai.service';
import { CatalogSyncService } from './catalog-sync.service';
import { PlayerCatalogController } from './player-catalog.controller';
import { PlayerCatalogService } from './player-catalog.service';
import { SquadVisionService } from './squad-vision.service';
import { WorldSimulationService } from './world-simulation.service';

@Module({
  imports: [PrismaModule, AuthModule, AiModule, ScoreReaderModule, AccessModule],
  controllers: [PlayerCatalogController],
  providers: [
    PlayerCatalogService,
    CatalogSyncService,
    SquadVisionService,
    AttributeAiService,
    WorldSimulationService,
  ],
})
export class PlayerCatalogModule {}
