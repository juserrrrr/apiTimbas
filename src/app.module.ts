import { Module } from '@nestjs/common';
import { UserModule } from './user/user.module';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './throttler.guard';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LeagueMatchModule } from './customLeagueMath/leagueMatch.module';
import { DiscordServerModule } from './discordServer/discordServer.module';
import { RiotModule } from './riot/riot.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { DiscordBotModule } from './discord/discord.module';
import { ClashModule } from './clash/clash.module';
import { AiModule } from './ai/ai.module';
import { VerifyModule } from './verify/verify.module';
import { PlayerStatsModule } from './playerStats/player-stats.module';
import { EaFcClubsModule } from './ea-fc-clubs/ea-fc-clubs.module';
import { CommonModule } from './common/common.module';
import { EconomyModule } from './economy/economy.module';
import { ScoreReaderModule } from './score-reader/score-reader.module';
import { TournamentModule } from './tournament/tournament.module';
import { DraftModule } from './draft/draft.module';
import { AccessModule } from './access/access.module';
import { DemoModule } from './demo/demo.module';
import { PlayerCatalogModule } from './player-catalog/player-catalog.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      // Default rate limit: 300 requests per 60 seconds
      {
        ttl: 60000,
        limit: 300,
        name: 'default',
      },
      // Strict limit for auth endpoints: 5 requests per 60 seconds
      {
        ttl: 60000,
        limit: 5,
        name: 'auth',
        skipIf: () => process.env.ENV_TYPE !== 'PRODUCTION',
      },
    ]),
    UserModule,
    AuthModule,
    LeagueMatchModule,
    DiscordServerModule,
    RiotModule,
    LeaderboardModule,
    DiscordBotModule,
    ClashModule,
    AiModule,
    VerifyModule,
    PlayerStatsModule,
    EaFcClubsModule,
    CommonModule,
    EconomyModule,
    ScoreReaderModule,
    TournamentModule,
    DraftModule,
    DemoModule,
    AccessModule,
    PlayerCatalogModule,
  ],
  controllers: [],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
