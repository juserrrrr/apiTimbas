import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessModule } from '../access/access.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { StreamingController } from './streaming.controller';
import { StreamingService } from './streaming.service';

@Module({
  imports: [AuthModule, AccessModule, FeatureFlagsModule],
  controllers: [StreamingController],
  providers: [StreamingService],
})
export class StreamingModule {}
