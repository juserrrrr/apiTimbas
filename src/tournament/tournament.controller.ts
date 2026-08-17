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
import { ActorService } from '../common/actor.service';
import { MatchProofService } from './match-proof.service';
import {
  AddTeamDto,
  CreateTournamentDto,
  ListTournamentsDto,
  ReportResultDto,
  ReviewProofDto,
  ScheduleMatchDto,
  SetSeedsDto,
  StaffDto,
  UpdateTeamDto,
  UpdateTournamentDto,
  WalkoverDto,
} from './dto/tournament.dto';
import { TournamentAccessService } from './tournament-access.service';
import { TournamentResultService } from './tournament-result.service';
import { TournamentService } from './tournament.service';

type AuthedRequest = Request & { tokenPayload?: { discordId?: string; role?: string } };

@UseGuards(AuthGuard, RoleGuard)
@Controller('tournaments')
export class TournamentController {
  constructor(
    private readonly tournaments: TournamentService,
    private readonly results: TournamentResultService,
    private readonly proofs: MatchProofService,
    private readonly access: TournamentAccessService,
    private readonly actor: ActorService,
  ) {}

  @Get()
  list(@Query() query: ListTournamentsDto) {
    return this.tournaments.list(query);
  }

  @Post()
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

  @Patch(':id/teams/:teamId')
  async updateTeam(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('teamId') teamId: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.tournaments.updateTeam(id, teamId, dto, await this.me(req));
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
    return this.results.walkover(matchId, dto.winnerTeamId, dto.reason, actor.discordId);
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
  async proofImage(@Param('proofId') proofId: string, @Res() res: Response) {
    const proof = await this.proofs.image(proofId);
    res.setHeader('Content-Type', proof.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(proof.image));
  }

  private me(req: AuthedRequest) {
    return this.actor.require(req.tokenPayload?.discordId);
  }
}
