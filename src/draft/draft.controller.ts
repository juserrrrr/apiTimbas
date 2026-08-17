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
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { DraftAccessService } from './draft-access.service';
import { DraftFixtureService } from './draft-fixture.service';
import { DraftMarketService } from './draft-market.service';
import { DraftPickService } from './draft-pick.service';
import { DraftSimulationService } from './draft-simulation.service';
import { DraftService } from './draft.service';
import {
  BaseMarketQueryDto,
  CreateDraftLeagueDto,
  CreateOfferDto,
  DraftStaffDto,
  ImportPlayersDto,
  JoinDraftDto,
  ListDraftLeaguesDto,
  MakePickDto,
  ReportDraftResultDto,
  RespondOfferDto,
  ReviewDraftProofDto,
  SetLineupDto,
  SetTacticsDto,
  SignFromBaseDto,
  UpdateDraftLeagueDto,
} from './dto/draft.dto';

type AuthedRequest = Request & { tokenPayload?: { discordId?: string } };

@UseGuards(AuthGuard, RoleGuard)
@Controller('draft')
export class DraftController {
  constructor(
    private readonly draft: DraftService,
    private readonly picks: DraftPickService,
    private readonly market: DraftMarketService,
    private readonly fixtures: DraftFixtureService,
    private readonly simulation: DraftSimulationService,
    private readonly access: DraftAccessService,
    private readonly actor: ActorService,
  ) {}

  @Get()
  list(@Query() query: ListDraftLeaguesDto) {
    return this.draft.list(query);
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(@Req() req: AuthedRequest, @Body() dto: CreateDraftLeagueDto) {
    return this.draft.create(dto, await this.me(req));
  }

  @Get(':id')
  async detail(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.draft.detail(id, await this.me(req));
  }

  @Patch(':id')
  async update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateDraftLeagueDto) {
    return this.draft.update(id, dto, await this.me(req));
  }

  @Delete(':id')
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.draft.remove(id, await this.me(req));
  }

  @Post(':id/join')
  async join(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: JoinDraftDto) {
    return this.draft.join(id, dto, await this.me(req));
  }

  @Delete(':id/join')
  async leave(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.draft.leave(id, await this.me(req));
  }

  @Get(':id/players')
  players(
    @Param('id') id: string,
    @Query('free') free?: string,
    @Query('search') search?: string,
    @Query('position') position?: string,
  ) {
    return this.draft.listPlayers(id, free === 'true', search, position);
  }

  @Post(':id/players')
  async importPlayers(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: ImportPlayersDto) {
    return this.draft.importPlayers(id, dto, await this.me(req));
  }

  @Delete(':id/players/:playerId')
  async removePlayer(@Req() req: AuthedRequest, @Param('id') id: string, @Param('playerId') playerId: string) {
    return this.draft.removePlayer(id, playerId, await this.me(req));
  }

  @Post(':id/staff')
  async setStaff(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: DraftStaffDto) {
    return this.draft.setStaff(id, dto, await this.me(req));
  }

  @Delete(':id/staff/:userId')
  async removeStaff(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.draft.removeStaff(id, userId, await this.me(req));
  }

  @Post(':id/staff/:userId/transfer-ownership')
  async transferOwnership(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.draft.transferOwnership(id, userId, await this.me(req));
  }

  @Post(':id/start')
  async start(@Req() req: AuthedRequest, @Param('id') id: string, @Query('shuffle') shuffle?: string) {
    return this.picks.startDraft(id, await this.me(req), shuffle !== 'false');
  }

  @Post(':id/pick')
  async pick(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: MakePickDto) {
    return this.picks.pick(id, dto.playerId, await this.me(req), dto.rosterId);
  }

  @Post(':id/lineup')
  async lineup(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: SetLineupDto) {
    return this.draft.setLineup(id, dto, await this.me(req));
  }

  @Post(':id/tactics')
  async tactics(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: SetTacticsDto) {
    return this.draft.setTactics(id, dto, await this.me(req));
  }

  @Get(':id/base-market')
  baseMarket(@Param('id') id: string, @Query() query: BaseMarketQueryDto) {
    return this.market.listBaseMarket(id, query.search, query.competitionId);
  }

  @Post(':id/base-market/sign')
  async signFromBase(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: SignFromBaseDto) {
    return this.market.signFromBase(id, dto.catalogPlayerId, await this.me(req));
  }

  @Get(':id/offers')
  async offers(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.market.listOffers(id, await this.me(req));
  }

  @Post(':id/offers')
  async createOffer(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: CreateOfferDto) {
    return this.market.createOffer(id, dto, await this.me(req));
  }

  @Post(':id/offers/:offerId/respond')
  async respondOffer(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('offerId') offerId: string,
    @Body() dto: RespondOfferDto,
  ) {
    return this.market.respond(id, offerId, dto.accept, await this.me(req));
  }

  @Delete(':id/offers/:offerId')
  async cancelOffer(@Req() req: AuthedRequest, @Param('id') id: string, @Param('offerId') offerId: string) {
    return this.market.cancel(id, offerId, await this.me(req));
  }

  @Post(':id/players/:playerId/release')
  async release(@Req() req: AuthedRequest, @Param('id') id: string, @Param('playerId') playerId: string) {
    return this.market.release(id, playerId, await this.me(req));
  }

  @Post(':id/matches/:matchId/simulate')
  async simulate(@Req() req: AuthedRequest, @Param('id') id: string, @Param('matchId') matchId: string) {
    await this.access.requireModerate(id, await this.me(req));
    return this.simulation.playOne(id, matchId);
  }

  @Get(':id/matches')
  matches(@Param('id') id: string, @Query('round') round?: string) {
    return this.fixtures.listMatches(id, round ? Number(round) : undefined);
  }

  @Post(':id/matches/:matchId/report')
  async report(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: ReportDraftResultDto,
  ) {
    return this.fixtures.report(id, matchId, dto, await this.me(req));
  }

  @Get(':id/proofs/pending')
  async pendingProofs(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.fixtures.pendingProofs(id, await this.me(req));
  }

  @Post(':id/proofs/:proofId/review')
  async reviewProof(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('proofId') proofId: string,
    @Body() dto: ReviewDraftProofDto,
  ) {
    return this.fixtures.reviewProof(id, proofId, dto.approve, dto.note, await this.me(req));
  }

  @Get(':id/proofs/:proofId/image')
  async proofImage(@Param('proofId') proofId: string, @Res() res: Response) {
    const proof = await this.fixtures.proofImage(proofId);
    res.setHeader('Content-Type', proof.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(proof.image));
  }

  private me(req: AuthedRequest) {
    return this.actor.require(req.tokenPayload?.discordId);
  }
}
