import { Module } from '@nestjs/common';
import { VerifyService } from './verify.service';
import { VerifyController } from './verify.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RiotModule } from '../riot/riot.module';
import { AuthModule } from '../auth/auth.module';
import { AccessModule } from '../access/access.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [PrismaModule, RiotModule, AuthModule, AccessModule, FeatureFlagsModule],
  controllers: [VerifyController],
  providers: [VerifyService],
  exports: [VerifyService],
})
export class VerifyModule {}
