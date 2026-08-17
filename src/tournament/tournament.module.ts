import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScoreReaderModule } from '../score-reader/score-reader.module';
import { MatchProofService } from './match-proof.service';
import { RegistrationWindowScheduler } from './registration-window.scheduler';
import { TournamentAccessService } from './tournament-access.service';
import { TournamentController } from './tournament.controller';
import { TournamentResultService } from './tournament-result.service';
import { TournamentService } from './tournament.service';

@Module({
  imports: [PrismaModule, AuthModule, EconomyModule, ScoreReaderModule],
  controllers: [TournamentController],
  providers: [
    TournamentService,
    TournamentResultService,
    TournamentAccessService,
    MatchProofService,
    RegistrationWindowScheduler,
  ],
  exports: [TournamentService, TournamentResultService],
})
export class TournamentModule {}
