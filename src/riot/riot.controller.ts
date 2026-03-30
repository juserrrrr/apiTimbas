import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  UseGuards,
  Headers,
  UnauthorizedException,
  ParseIntPipe,
} from '@nestjs/common';
import { RiotService } from './riot.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { CreateMatchesDto } from './dto/create-matches.dto';
import { TournamentMatchDto } from './dto/tournament-match.dto';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';

@UseGuards(AuthGuard, RoleGuard)
@Controller('riot')
export class RiotController {
  constructor(private readonly riotService: RiotService) {}

  // ─── LoL Data (accessible by BOT and ADMIN) ───────────────────────────────

  @Roles(Role.ADMIN, Role.BOT)
  @Get('player/:gameName/:tagLine')
  async getPlayerInfo(
    @Param('gameName') gameName: string,
    @Param('tagLine') tagLine: string,
  ) {
    return this.riotService.getPlayerInfo(gameName, tagLine);
  }

  @Roles(Role.ADMIN, Role.BOT)
  @Post('verify-icon')
  async verifyIcon(@Body() { puuid, iconId }: { puuid: string; iconId: number }) {
    return this.riotService.verifyIcon(puuid, iconId);
  }

  @Roles(Role.ADMIN, Role.BOT)
  @Get('champions')
  async getAllChampions() {
    return this.riotService.getAllChampions();
  }

  @Roles(Role.ADMIN, Role.BOT)
  @Get('profile-icon/:iconId')
  async getProfileIconUrl(@Param('iconId', ParseIntPipe) iconId: number) {
    return { url: this.riotService.buildProfileIconUrl(iconId) };
  }

  @Roles(Role.ADMIN, Role.BOT)
  @Get('champion-icon/:championName')
  async getChampionIconUrl(@Param('championName') championName: string) {
    return { url: await this.riotService.buildChampionIconUrl(championName) };
  }

  @Roles(Role.ADMIN, Role.BOT)
  @Get('summoner/:summonerName')
  async getSummonerByName(@Param('summonerName') summonerName: string) {
    return this.riotService.getSummonerByName(summonerName);
  }

  // ─── Tournament management (ADMIN only) ──────────────────────────────────

  @Roles(Role.ADMIN)
  @Post('tournaments/providers')
  async createTournamentProvider(@Body() createProviderDto: CreateProviderDto) {
    return this.riotService.createTournamentProvider(createProviderDto);
  }

  @Roles(Role.ADMIN)
  @Post('tournaments')
  async createTournament(@Body() createTournamentDto: CreateTournamentDto) {
    return this.riotService.createTournament(createTournamentDto);
  }

  @Roles(Role.ADMIN)
  @Post('tournaments/:tournamentId/matches')
  async createTournamentMatches(
    @Param('tournamentId') tournamentId: number,
    @Body() createMatchesDto: CreateMatchesDto,
  ) {
    return this.riotService.createTournamentMatches(tournamentId, createMatchesDto);
  }

  // ─── Riot callback (validated by secret header) ───────────────────────────

  @Roles()
  @Post('tournaments/match-callback')
  async tournamentMatchCallback(
    @Body() tournamentMatchDto: TournamentMatchDto,
    @Headers('x-riot-secret') secret: string,
  ) {
    const expectedSecret = process.env.RIOT_CALLBACK_SECRET;
    if (!expectedSecret || secret !== expectedSecret) {
      throw new UnauthorizedException('Invalid callback secret');
    }
    return this.riotService.handleMatchCallback(tournamentMatchDto);
  }
}
