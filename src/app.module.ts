import { Module } from '@nestjs/common';
import { UserModule } from './user/user.module';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LeagueMatchModule } from './customLeagueMath/leagueMatch.module';
import { DiscordServerModule } from './discordServer/discordServer.module';
import { RiotModule } from './riot/riot.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { DiscordBotModule } from './discord/discord.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      // Default rate limit: 50 requests per 60 seconds
      {
        ttl: 60000,
        limit: 50,
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
  ],
  controllers: [],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
