import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard, RequirePermissions } from '../access/permission.guard';
import { ActorService } from '../common/actor.service';
import { DemoService } from './demo.service';
import { EaFcClubsService } from '../ea-fc-clubs/ea-fc-clubs.service';
import { TournamentMatchService } from '../tournament/tournament-match.service';
import { AssignLiveEaGroupsDto, BuildDemoDraftDto, BuildDemoTournamentDto, BuildEaFourGroupsTournamentDto, BuildRealEaTournamentDto, CreateLiveEaTournamentDto, DemoEaClubDto, DemoEaHistoryDto, DemoEaMatchLookupDto, DemoEaSyncDto, PrepareDemoEaMatchDto } from './dto/demo.dto';
import { AwardCardSettingsService } from '../settings/award-card-settings.service';

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
    private readonly awardCards: AwardCardSettingsService,
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

  @Get('award-card-settings')
  awardCardSettings() {
    return this.awardCards.get();
  }

  @Post('award-card-settings')
  saveAwardCardSettings(@Body() body: unknown) {
    return this.awardCards.save(body);
  }

  @Post('ea/club')
  findEaClub(@Body() dto: DemoEaClubDto) {
    return this.eaClubs.resolveTournamentClub(dto.name, 'common-gen5');
  }

  @Post('ea/clubs/search')
  searchEaClubs(@Body() dto: DemoEaClubDto) {
    return this.eaClubs.searchClubs({ name: dto.name, platform: 'common-gen5' });
  }

  @Post('ea/history')
  async eaHistory(@Body() dto: DemoEaHistoryDto) {
    const matches = await this.eaClubs.friendlyMatches(dto.clubId, 'common-gen5');
    return { count: matches.length, latest: matches[0] ?? null, matches };
  }

  @Post('ea/match/raw')
  async rawEaMatch(@Body() dto: DemoEaMatchLookupDto) {
    const matches = await this.eaClubs.friendlyMatches(dto.clubId, 'common-gen5');
    const match = matches.find((item) => item.externalMatchId === dto.externalMatchId);
    if (!match) throw new BadRequestException('Esse EA Match ID não apareceu entre os amistosos recentes do clube informado.');
    return match;
  }

  @Post('ea/tournament')
  async realEaTournament(@Req() req: AuthedRequest, @Body() dto: BuildRealEaTournamentDto) {
    return this.demo.buildRealEaTournament(dto, await this.actor.require(req.tokenPayload?.discordId));
  }

  @Post('ea/tournament/four-groups')
  async fourGroupsEaTournament(@Req() req: AuthedRequest, @Body() dto: BuildEaFourGroupsTournamentDto) {
    return this.demo.buildEaFourGroupsTournament(dto.name.trim(), dto.externalMatchId, await this.actor.require(req.tokenPayload?.discordId));
  }

  @Post('ea/live')
  async createLiveEaTournament(@Req() req: AuthedRequest, @Body() dto: CreateLiveEaTournamentDto) {
    return this.demo.createLiveEaTournament(dto, await this.actor.require(req.tokenPayload?.discordId));
  }

  @Get('ea/live/:id')
  liveEaTournament(@Param('id') id: string) {
    return this.demo.liveEaWorkspace(id);
  }

  @Post('ea/live/:id/groups')
  async assignLiveEaGroups(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: AssignLiveEaGroupsDto) {
    return this.demo.assignLiveEaGroups(id, dto, await this.actor.require(req.tokenPayload?.discordId));
  }

  @Post('ea/live/:id/knockout')
  buildLiveEaKnockout(@Param('id') id: string) {
    return this.demo.buildLiveEaKnockout(id);
  }

  @Post('ea/sync')
  async syncEaMatch(@Req() req: AuthedRequest, @Body() dto: DemoEaSyncDto) {
    return this.tournamentMatches.checkEaResult(
      dto.tournamentId,
      dto.matchId,
      await this.actor.require(req.tokenPayload?.discordId),
    );
  }

  @Post('ea/prepare')
  async prepareEaMatch(@Req() req: AuthedRequest, @Body() dto: PrepareDemoEaMatchDto) {
    const actor = await this.actor.require(req.tokenPayload?.discordId);
    const history = await this.eaClubs.friendlyMatches(dto.clubId, 'common-gen5');
    const eaMatch = history.find((match) => match.externalMatchId === dto.externalMatchId);
    if (!eaMatch) throw new BadRequestException('A partida escolhida não está mais no histórico desse clube na EA.');
    return this.demo.prepareEaMatch(dto, eaMatch, actor);
  }

  @Delete()
  clear() {
    return this.demo.clear();
  }
}
