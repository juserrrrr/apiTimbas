import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard, RequirePermissions } from '../access/permission.guard';
import { ActorService } from '../common/actor.service';
import { DemoService } from './demo.service';
import { BuildDemoDraftDto, BuildDemoTournamentDto } from './dto/demo.dto';

type AuthedRequest = Request & { tokenPayload?: { discordId?: string } };

@UseGuards(AuthGuard, PermissionGuard)
@RequirePermissions('demo.manage')
@Controller('admin/demo')
export class DemoController {
  constructor(
    private readonly demo: DemoService,
    private readonly actor: ActorService,
  ) {}

  @Get()
  list() {
    return this.demo.list();
  }

  @Post('tournament')
  async tournament(@Req() req: AuthedRequest, @Body() dto: BuildDemoTournamentDto) {
    return this.demo.buildTournament(dto, await this.actor.require(req.tokenPayload?.discordId));
  }

  @Post('draft')
  async draft(@Req() req: AuthedRequest, @Body() dto: BuildDemoDraftDto) {
    return this.demo.buildDraftLeague(dto, await this.actor.require(req.tokenPayload?.discordId));
  }

  @Delete()
  clear() {
    return this.demo.clear();
  }
}
