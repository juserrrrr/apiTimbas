import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EaFcClubsController } from './ea-fc-clubs.controller';
import { EaFcClubsProvider } from './ea-fc-clubs.provider';
import { EaFcClubsService } from './ea-fc-clubs.service';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    ConfigModule,
    HttpModule.register({ baseURL: 'https://proclubs.ea.com/api/fc' }),
  ],
  controllers: [EaFcClubsController],
  providers: [EaFcClubsProvider, EaFcClubsService],
  exports: [EaFcClubsService],
})
export class EaFcClubsModule {}
