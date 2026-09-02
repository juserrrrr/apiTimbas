import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuthModule } from '../auth/auth.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { PrismaModule } from '../prisma/prisma.module';
import { GameServerService } from './game-server.service';
import { GameTicketsService } from './game-tickets.service';
import { GamesController } from './games.controller';

@Module({
  imports: [AuthModule, AccessModule, FeatureFlagsModule, PrismaModule],
  controllers: [GamesController],
  providers: [GameServerService, GameTicketsService],
  exports: [GameServerService],
})
export class GamesModule {}
