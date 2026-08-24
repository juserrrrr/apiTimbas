import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard, RequirePermissions } from '../access/permission.guard';
import { ActorService } from '../common/actor.service';
import { DemoService } from './demo.service';
import { EaFcClubsService } from '../ea-fc-clubs/ea-fc-clubs.service';
import { TournamentMatchService } from '../tournament/tournament-match.service';
import { BuildDemoDraftDto, BuildDemoTournamentDto, DemoEaClubDto, DemoEaHistoryDto, DemoEaSyncDto } from './dto/demo.dto';

type AuthedRequest = Request & { tokenPayload?: { discordId?: string } };

@UseGuards(AuthGuard, PermissionGuard)
@RequirePermissions('demo.manage')
@Controller('admin/demo')
export class DemoController {
  constructor(
    private readonly demo: DemoService,
    private readonly actor: ActorService,
    private readonly eaClubs: EaFcClubsService,
    private readonly tournamentMatches: TournamentMatchService,
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

  @Post('ea/club')
  findEaClub(@Body() dto: DemoEaClubDto) {
    return this.eaClubs.resolveTournamentClub(dto.name, 'common-gen5');
  }

  @Post('ea/history')
  async eaHistory(@Body() dto: DemoEaHistoryDto) {
    const matches = await this.eaClubs.friendlyMatches(dto.clubId, 'common-gen5');
    return { count: matches.length, latest: matches[0] ?? null, matches };
  }

  @Post('ea/sync')
  async syncEaMatch(@Req() req: AuthedRequest, @Body() dto: DemoEaSyncDto) {
    return this.tournamentMatches.checkEaResult(
      dto.tournamentId,
      dto.matchId,
      await this.actor.require(req.tokenPayload?.discordId),
    );
  }

  @Delete()
  clear() {
    return this.demo.clear();
  }
}
