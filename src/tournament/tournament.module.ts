import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessModule } from '../access/access.module';
import { EconomyModule } from '../economy/economy.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScoreReaderModule } from '../score-reader/score-reader.module';
import { EaFcClubsModule } from '../ea-fc-clubs/ea-fc-clubs.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { MatchProofService } from './match-proof.service';
import { RegistrationWindowScheduler } from './registration-window.scheduler';
import { TournamentAccessService } from './tournament-access.service';
import { TournamentController } from './tournament.controller';
import { TournamentResultService } from './tournament-result.service';
import { TournamentMatchService } from './tournament-match.service';
import { TournamentService } from './tournament.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, AuthModule, AccessModule, EconomyModule, ScoreReaderModule, EaFcClubsModule, FeatureFlagsModule, SettingsModule],
  controllers: [TournamentController],
  providers: [
    TournamentService,
    TournamentResultService,
    TournamentMatchService,
    TournamentAccessService,
    MatchProofService,
    RegistrationWindowScheduler,
  ],
  exports: [TournamentService, TournamentResultService, TournamentMatchService],
})
export class TournamentModule {}
