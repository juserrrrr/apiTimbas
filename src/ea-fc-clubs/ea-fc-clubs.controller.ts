import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import {
  CreateEaClubDto,
  SearchEaClubsDto,
  ValidateEaClubDto,
} from './dto/create-ea-club.dto';
import { EaLeaderboardQueryDto } from './dto/leaderboard-query.dto';
import { EaMatchQueryDto } from './dto/match-query.dto';
import { EaFcClubsService } from './ea-fc-clubs.service';

@UseGuards(AuthGuard, RoleGuard)
@Controller('ea-clubs')
export class EaFcClubsController {
  constructor(private readonly clubs: EaFcClubsService) {}

  @Post('validate')
  @Roles(Role.ADMIN)
  validate(@Body() dto: ValidateEaClubDto) {
    return this.clubs.validateClub(dto);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateEaClubDto) {
    return this.clubs.createClub(dto);
  }

  @Get()
  list() {
    return this.clubs.listClubs();
  }

  @Get('search')
  @Roles(Role.ADMIN)
  search(@Query() query: SearchEaClubsDto) {
    return this.clubs.searchClubs(query);
  }

  @Get(':id')
  getClub(@Param('id') id: string) {
    return this.clubs.getClub(id);
  }

  @Post(':id/sync')
  @Roles(Role.ADMIN)
  sync(@Param('id') id: string) {
    return this.clubs.sync(id);
  }

  @Get(':id/dashboard')
  dashboard(@Param('id') id: string) {
    return this.clubs.getDashboard(id);
  }

  @Get(':id/matches')
  matches(@Param('id') id: string, @Query() query: EaMatchQueryDto) {
    return this.clubs.getMatches(id, query);
  }

  @Get(':id/matches/:matchId')
  match(@Param('id') id: string, @Param('matchId') matchId: string) {
    return this.clubs.getMatch(id, matchId);
  }

  @Get(':id/players')
  players(@Param('id') id: string) {
    return this.clubs.getPlayers(id);
  }

  @Get(':id/players/:playerId')
  player(@Param('id') id: string, @Param('playerId') playerId: string) {
    return this.clubs.getPlayer(id, playerId);
  }

  @Get(':id/leaderboard')
  leaderboard(@Param('id') id: string, @Query() query: EaLeaderboardQueryDto) {
    return this.clubs.getLeaderboard(id, query);
  }
}
