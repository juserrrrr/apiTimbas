import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { PermissionGuard, RequirePermissions } from '../access/permission.guard';
import { ActorService } from '../common/actor.service';
import { MatchProofService } from './match-proof.service';
import {
  AddTeamDto,
  ClaimResultDto,
  CheckEaResultDto,
  MatchMessageDto,
  ProposeScheduleDto,
  RespondClaimDto,
  RespondScheduleDto,
  CreateTournamentDto,
  ListTournamentsDto,
  JoinByInviteDto,
  ReportResultDto,
  ReviewProofDto,
  RequestMatchReviewDto,
  ScheduleMatchDto,
  SetMatchReadyDto,
  SetSeedsDto,
  StaffDto,
  UpdateTeamDto,
  UpdateTournamentDto,
  WalkoverDto,
  ValidateTournamentEaClubDto,
} from './dto/tournament.dto';
import { TournamentAccessService } from './tournament-access.service';
import { TournamentResultService } from './tournament-result.service';
import { TournamentMatchService } from './tournament-match.service';
import { TournamentService } from './tournament.service';
import { AwardCardSettingsService } from '../settings/award-card-settings.service';
import { RequireFeature } from '../decorators/feature.decorator';
import { FeatureFlagGuard } from '../feature-flags/guards/feature-flag.guard';
import { FEATURE_DASHBOARD_TOURNAMENTS } from '../feature-flags/feature-flags.constants';

type AuthedRequest = Request & { tokenPayload?: { discordId?: string; role?: string } };

@UseGuards(AuthGuard, RoleGuard, FeatureFlagGuard, PermissionGuard)
@RequireFeature(FEATURE_DASHBOARD_TOURNAMENTS)
@RequirePermissions('dashboard.tournaments')
@Controller('tournaments')
export class TournamentController {
  constructor(
    private readonly tournaments: TournamentService,
    private readonly results: TournamentResultService,
    private readonly proofs: MatchProofService,
    private readonly matches: TournamentMatchService,
    private readonly access: TournamentAccessService,
    private readonly actor: ActorService,
    private readonly awardCards: AwardCardSettingsService,
  ) {}

  @Get()
  async list(@Req() req: AuthedRequest, @Query() query: ListTournamentsDto) {
    return this.tournaments.list(query, await this.me(req));
  }

  @Post('join-by-invite')
  async joinByInvite(@Req() req: AuthedRequest, @Body() dto: JoinByInviteDto) {
    return this.tournaments.joinByInvite(dto.code, await this.me(req));
  }

  @Post()
  @RequirePermissions('tournament.create')
  async create(@Req() req: AuthedRequest, @Body() dto: CreateTournamentDto) {
    return this.tournaments.create(dto, await this.me(req));
  }

  @Get(':id')
  async detail(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.tournaments.detail(id, await this.me(req));
  }

  @Patch(':id')
  async update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateTournamentDto) {
    return this.tournaments.update(id, dto, await this.me(req));
  }

  @Delete(':id')
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.tournaments.remove(id, await this.me(req));
  }

  @Post(':id/start')
  async start(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.tournaments.start(id, await this.me(req));
  }

  @Post(':id/teams')
  async addTeam(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: AddTeamDto) {
    return this.tournaments.addTeam(id, dto, await this.me(req));
  }

  @Get('award-cards/settings')
  awardCardSettings() {
    return this.awardCards.get();
  }

  @Post(':id/ea-club/validate')
  async validateEaClub(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: ValidateTournamentEaClubDto,
  ) {
    return this.tournaments.validateEaClub(id, dto.name, dto.platform ?? 'common-gen5', await this.me(req));
  }

  @Get(':id/ea-stats')
  async eaStats(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.tournaments.eaStats(id, await this.me(req));
  }

  @Get(':id/ea-awards')
  async eaAwards(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.tournaments.eaAwards(id, await this.me(req));
  }

  @Patch(':id/teams/:teamId')
  async updateTeam(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('teamId') teamId: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.tournaments.updateTeam(id, teamId, dto, await this.me(req));
  }

  @Patch(':id/teams/:teamId/ea-club')
  async replaceTeamEaClub(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('teamId') teamId: string,
    @Body() dto: ValidateTournamentEaClubDto,
  ) {
    return this.tournaments.replaceTeamEaClub(id, teamId, dto.name, dto.platform ?? 'common-gen5', await this.me(req));
  }

  @Delete(':id/teams/:teamId')
  async removeTeam(@Req() req: AuthedRequest, @Param('id') id: string, @Param('teamId') teamId: string) {
    return this.tournaments.removeTeam(id, teamId, await this.me(req));
  }

  @Post(':id/seeds')
  async setSeeds(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: SetSeedsDto) {
    return this.tournaments.setSeeds(id, dto, await this.me(req));
  }

  @Post(':id/staff')
  async setStaff(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: StaffDto) {
    return this.tournaments.setStaff(id, dto, await this.me(req));
  }

  @Delete(':id/staff/:userId')
  async removeStaff(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.tournaments.removeStaff(id, userId, await this.me(req));
  }

  @Post(':id/staff/:userId/transfer-ownership')
  async transferOwnership(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.tournaments.transferOwnership(id, userId, await this.me(req));
  }

  @Post(':id/matches/:matchId/report')
  async report(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: ReportResultDto,
  ) {
    return this.proofs.report(id, matchId, dto, await this.me(req));
  }

  @Patch(':id/matches/:matchId/correct-result')
  async correctLabResult(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: ClaimResultDto,
  ) {
    const actor = await this.me(req);
    await this.access.requireModerate(id, actor);
    return this.results.correctLabGroupResult(id, matchId, dto.homeScore, dto.awayScore, actor.discordId);
  }

  @Patch(':id/matches/:matchId/schedule')
  async schedule(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: ScheduleMatchDto,
  ) {
    await this.access.requireModerate(id, await this.me(req));
    return this.tournaments.scheduleMatch(id, matchId, dto.scheduledAt);
  }

  @Post(':id/matches/:matchId/walkover')
  async walkover(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: WalkoverDto,
  ) {
    const actor = await this.me(req);
    await this.access.requireModerate(id, actor);
    return this.results.walkover(
      id,
      matchId,
      dto.winnerTeamId,
      dto.reason,
      actor.discordId,
      dto.homeScore,
      dto.awayScore,
    );
  }

  @Get(':id/matches/:matchId/chat')
  async matchChat(@Req() req: AuthedRequest, @Param('id') id: string, @Param('matchId') matchId: string) {
    return this.matches.view(id, matchId, await this.me(req));
  }

  @Post(':id/matches/:matchId/chat')
  async postMatchMessage(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: MatchMessageDto,
  ) {
    return this.matches.postMessage(id, matchId, dto, await this.me(req));
  }

  @Post(':id/matches/:matchId/propose')
  async proposeSchedule(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: ProposeScheduleDto,
  ) {
    return this.matches.proposeSchedule(id, matchId, dto, await this.me(req));
  }

  @Post(':id/matches/:matchId/propose/respond')
  async respondSchedule(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: RespondScheduleDto,
  ) {
    return this.matches.respondSchedule(id, matchId, dto, await this.me(req));
  }

  @Post(':id/matches/:matchId/claim')
  async claimResult(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: ClaimResultDto,
  ) {
    return this.matches.claimResult(id, matchId, dto, await this.me(req));
  }

  @Post(':id/lab/knockout')
  async buildLabKnockout(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.access.requireModerate(id, await this.me(req));
    return this.results.buildLabKnockout(id);
  }

  @Post(':id/lab/knockout/rebuild')
  async rebuildLabKnockout(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.access.requireModerate(id, await this.me(req));
    return this.results.rebuildLabKnockout(id);
  }

  @Get(':id/lab/score-audit')
  async auditLabEaScores(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.access.requireModerate(id, await this.me(req));
    return this.results.auditLabEaScores(id);
  }

  @Post(':id/matches/:matchId/lab/discard-ea-result')
  async discardInterruptedLabEaResult(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
  ) {
    await this.access.requireModerate(id, await this.me(req));
    return this.results.discardInterruptedLabEaResult(id, matchId);
  }

  @Post(':id/matches/:matchId/cancel-walkover')
  async cancelWalkover(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: ClaimResultDto,
  ) {
    const actor = await this.me(req);
    await this.access.requireModerate(id, actor);
    return this.results.cancelWalkover(id, matchId, dto.homeScore, dto.awayScore, actor.discordId);
  }

  @Post(':id/matches/:matchId/grace')
  async requestGrace(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
  ) {
    return this.matches.requestGrace(id, matchId, await this.me(req));
  }

  @Post(':id/matches/:matchId/ready')
  async setMatchReady(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: SetMatchReadyDto,
  ) {
    return this.matches.setReady(id, matchId, dto.ready, await this.me(req));
  }

  @Post(':id/matches/:matchId/check-ea')
  async checkEaResult(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: CheckEaResultDto,
  ) {
    return this.matches.checkEaResult(id, matchId, await this.me(req), dto.eaMatchId);
  }

  @Post(':id/matches/:matchId/lab/rescan-ea')
  async rescanClosedLabEaResult(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
  ) {
    return this.matches.rescanClosedLabEaResult(id, matchId, await this.me(req));
  }

  @Post(':id/matches/:matchId/request-review')
  async requestMatchReview(@Req() req: AuthedRequest, @Param('id') id: string, @Param('matchId') matchId: string, @Body() dto: RequestMatchReviewDto) {
    return this.matches.requestReview(id, matchId, dto, await this.me(req));
  }

  @Get(':id/reviews/pending')
  async pendingMatchReviews(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.matches.pendingReviews(id, await this.me(req));
  }

  @Post(':id/matches/:matchId/resolve-review')
  async resolveMatchReview(@Req() req: AuthedRequest, @Param('id') id: string, @Param('matchId') matchId: string, @Body() dto: ClaimResultDto) {
    return this.matches.resolveReview(id, matchId, dto, await this.me(req));
  }

  @Post(':id/matches/:matchId/reject-ea-audit')
  async rejectEaAudit(@Req() req: AuthedRequest, @Param('id') id: string, @Param('matchId') matchId: string) {
    return this.matches.rejectEaAudit(id, matchId, await this.me(req));
  }

  @Post(':id/matches/:matchId/claim/respond')
  async respondClaim(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: RespondClaimDto,
  ) {
    return this.matches.respondClaim(id, matchId, dto, await this.me(req));
  }

  @Get(':id/proofs/pending')
  async pendingProofs(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.proofs.pending(id, await this.me(req));
  }

  @Post(':id/proofs/:proofId/review')
  async reviewProof(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('proofId') proofId: string,
    @Body() dto: ReviewProofDto,
  ) {
    return this.proofs.review(id, proofId, dto, await this.me(req));
  }

  @Get(':id/proofs/:proofId/image')
  async proofImage(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('proofId') proofId: string,
    @Res() res: Response,
  ) {
    const proof = await this.proofs.image(id, proofId, await this.me(req));
    res.setHeader('Content-Type', proof.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(proof.image));
  }

  private me(req: AuthedRequest) {
    return this.actor.require(req.tokenPayload?.discordId);
  }
}
