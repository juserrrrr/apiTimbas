import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AccessModule } from '../access/access.module';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagGuard } from './guards/feature-flag.guard';

@Module({
  imports: [PrismaModule, AuthModule, AccessModule],
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsService, FeatureFlagGuard],
  exports: [FeatureFlagsService, FeatureFlagGuard],
})
export class FeatureFlagsModule {}
