import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard, RequirePermissions } from '../access/permission.guard';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';
import { UpdateTournamentEaAutomationDto } from './dto/update-tournament-ea-automation.dto';
import { FeatureFlagsService } from './feature-flags.service';
import { ActorService } from '../common/actor.service';
import { Request } from 'express';

type AuthedRequest = Request & { tokenPayload?: { discordId?: string } };

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(
    private readonly featureFlags: FeatureFlagsService,
    private readonly actor: ActorService,
  ) {}

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

  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermissions('features.manage')
  @Get('tournament-ea/automation')
  getTournamentEaAutomation() {
    return this.featureFlags.getTournamentEaAutomationSettings();
  }

  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermissions('features.manage')
  @Patch('tournament-ea/automation')
  async updateTournamentEaAutomation(
    @Req() req: AuthedRequest,
    @Body() dto: UpdateTournamentEaAutomationDto,
  ) {
    const actor = await this.actor.require(req.tokenPayload?.discordId);
    return this.featureFlags.updateTournamentEaAutomationSettings(
      dto.checkIntervalSeconds,
      dto.checksPerMinute,
      actor.discordId,
    );
  }
}
