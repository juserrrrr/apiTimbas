import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessModule } from '../access/access.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StreamingController } from './streaming.controller';
import { PublicStreamingController } from './public-streaming.controller';
import { StreamingService } from './streaming.service';

@Module({
  imports: [AuthModule, AccessModule, FeatureFlagsModule, PrismaModule],
  controllers: [StreamingController, PublicStreamingController],
  providers: [StreamingService],
})
export class StreamingModule {}
