import { Module } from '@nestjs/common';
import { RiotService } from './riot.service';
import { RiotController } from './riot.controller';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
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
})
export class RiotModule {}
