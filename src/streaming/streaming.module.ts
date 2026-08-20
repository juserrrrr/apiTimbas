import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessModule } from '../access/access.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StreamingController } from './streaming.controller';
import { PublicStreamingController } from './public-streaming.controller';
import { StreamingEventsController } from './streaming-events.controller';
import { StreamingService } from './streaming.service';

@Module({
  imports: [AuthModule, AccessModule, FeatureFlagsModule, PrismaModule],
  controllers: [
    StreamingController,
    StreamingEventsController,
    PublicStreamingController,
  ],
  providers: [StreamingService],
})
export class StreamingModule {}
