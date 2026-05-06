import { Module } from '@nestjs/common';
import { VerifyService } from './verify.service';
import { VerifyController } from './verify.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RiotModule } from '../riot/riot.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, RiotModule, AuthModule],
  controllers: [VerifyController],
  providers: [VerifyService],
  exports: [VerifyService],
})
export class VerifyModule {}
