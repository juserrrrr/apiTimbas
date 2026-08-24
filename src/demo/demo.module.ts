import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuthModule } from '../auth/auth.module';
import { DraftModule } from '../draft/draft.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TournamentModule } from '../tournament/tournament.module';
import { EaFcClubsModule } from '../ea-fc-clubs/ea-fc-clubs.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, AuthModule, TournamentModule, DraftModule, AccessModule, EaFcClubsModule, SettingsModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
