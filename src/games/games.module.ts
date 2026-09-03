import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuthModule } from '../auth/auth.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { GameServerService } from './game-server.service';
import { GameMapService } from './game-map.service';
import { GameTicketsService } from './game-tickets.service';
import { GamesController } from './games.controller';

@Module({
  imports: [AuthModule, AccessModule, FeatureFlagsModule, PrismaModule, SettingsModule],
  controllers: [GamesController],
  providers: [GameServerService, GameTicketsService, GameMapService],
  exports: [GameServerService],
})
export class GamesModule {}
