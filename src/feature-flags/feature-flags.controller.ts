import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard, RequirePermissions } from '../access/permission.guard';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlags: FeatureFlagsService) {}

  @UseGuards(AuthGuard)
  @Get()
  async findAll() {
    return this.featureFlags.findAll();
  }

  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermissions('features.manage')
  @Patch(':key')
  async update(@Param('key') key: string, @Body() dto: UpdateFeatureFlagDto) {
    return this.featureFlags.setEnabled(key, dto.enabled);
  }
}
