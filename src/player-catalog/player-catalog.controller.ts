import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { CatalogSyncService } from './catalog-sync.service';
import { PlayerCatalogService } from './player-catalog.service';
import { SquadVisionService } from './squad-vision.service';
import {
  BulkPlayersDto,
  BulkTeamsDto,
  CreateCompetitionDto,
  CreateTeamDto,
  ExtractSquadDto,
  ExtractTeamsDto,
  ImportToLeagueDto,
  ParseTextDto,
  UpdateCompetitionDto,
  UpdatePlayerDto,
  UpdateTeamDto,
} from './dto/player-catalog.dto';

@UseGuards(AuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('admin/catalog')
export class PlayerCatalogController {
  constructor(
    private readonly catalog: PlayerCatalogService,
    private readonly sync: CatalogSyncService,
    private readonly vision: SquadVisionService,
  ) {}

  @Get('competitions')
  async competitions() {
    return {
      items: await this.catalog.listCompetitions(),
      footballDataReady: this.sync.hasFootballDataToken(),
    };
  }

  @Post('competitions')
  createCompetition(@Body() dto: CreateCompetitionDto) {
    return this.catalog.createCompetition(dto);
  }

  @Patch('competitions/:id')
  updateCompetition(@Param('id') id: string, @Body() dto: UpdateCompetitionDto) {
    return this.catalog.updateCompetition(id, dto);
  }

  @Delete('competitions/:id')
  removeCompetition(@Param('id') id: string) {
    return this.catalog.removeCompetition(id);
  }

  @Post('competitions/:id/sync')
  syncCompetition(@Param('id') id: string) {
    return this.sync.sync(id);
  }

  @Get('competitions/:id/teams')
  teams(@Param('id') id: string) {
    return this.catalog.listTeams(id);
  }

  @Post('competitions/:id/teams')
  createTeam(@Param('id') id: string, @Body() dto: CreateTeamDto) {
    return this.catalog.createTeam(id, dto);
  }

  @Post('competitions/:id/teams/bulk')
  createTeams(@Param('id') id: string, @Body() dto: BulkTeamsDto) {
    return this.catalog.createTeams(id, dto.teams);
  }

  @Patch('teams/:teamId')
  updateTeam(@Param('teamId') teamId: string, @Body() dto: UpdateTeamDto) {
    return this.catalog.updateTeam(teamId, dto);
  }

  @Delete('teams/:teamId')
  removeTeam(@Param('teamId') teamId: string) {
    return this.catalog.removeTeam(teamId);
  }

  @Get('teams/:teamId/players')
  players(@Param('teamId') teamId: string) {
    return this.catalog.listPlayers(teamId);
  }

  @Post('teams/:teamId/players')
  savePlayers(@Param('teamId') teamId: string, @Body() dto: BulkPlayersDto) {
    return this.catalog.savePlayers(teamId, dto);
  }

  @Patch('players/:playerId')
  updatePlayer(@Param('playerId') playerId: string, @Body() dto: UpdatePlayerDto) {
    return this.catalog.updatePlayer(playerId, dto);
  }

  @Delete('players/:playerId')
  removePlayer(@Param('playerId') playerId: string) {
    return this.catalog.removePlayer(playerId);
  }

  @Post('extract-squad')
  extractSquad(@Body() dto: ExtractSquadDto) {
    return this.vision.extract(dto.imageBase64, dto.mimeType, dto.teamName);
  }

  @Post('parse-pasted-players')
  parsePastedPlayers(@Body() dto: ParseTextDto) {
    return this.catalog.parsePastedPlayers(dto.text);
  }

  @Post('parse-pasted-teams')
  parsePastedTeams(@Body() dto: ParseTextDto) {
    return this.catalog.parsePastedTeams(dto.text);
  }

  @Post('parse-squad-text')
  parseSquadText(@Body() dto: ParseTextDto) {
    return this.vision.extractFromText(dto.text, dto.teamName);
  }

  @Post('extract-teams')
  extractTeams(@Body() dto: ExtractTeamsDto) {
    return this.vision.extractTeams(dto);
  }

  @Post('import-to-league')
  importToLeague(@Body() dto: ImportToLeagueDto) {
    return this.catalog.importToLeague(dto);
  }
}
