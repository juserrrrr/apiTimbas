import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuthModule } from '../auth/auth.module';
import { DraftModule } from '../draft/draft.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TournamentModule } from '../tournament/tournament.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

@Module({
  imports: [PrismaModule, AuthModule, TournamentModule, DraftModule, AccessModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
