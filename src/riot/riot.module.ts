import { Module } from '@nestjs/common';
import { RiotService } from './riot.service';
import { RiotController } from './riot.controller';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot(),
    HttpModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        baseURL: 'https://br1.api.riotgames.com',
        headers: {
          'X-Riot-Token': configService.get<string>('RIOT_API_KEY'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [RiotService],
  controllers: [RiotController],
  exports: [RiotService],
})
export class RiotModule {}
