import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { RiotService } from './riot.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { CreateMatchesDto } from './dto/create-matches.dto';
import { TournamentMatchDto } from './dto/tournament-match.dto';

@Controller('riot')
export class RiotController {
  constructor(private readonly riotService: RiotService) {}

  @Get('summoner/:summonerName')
  async getSummonerByName(@Param('summonerName') summonerName: string) {
    return this.riotService.getSummonerByName(summonerName);
  }

  @Post('tournaments/providers')
  async createTournamentProvider(@Body() createProviderDto: CreateProviderDto) {
    return this.riotService.createTournamentProvider(createProviderDto);
  }

  @Post('tournaments')
  async createTournament(@Body() createTournamentDto: CreateTournamentDto) {
    return this.riotService.createTournament(createTournamentDto);
  }

  @Post('tournaments/:tournamentId/matches')
  async createTournamentMatches(
    @Param('tournamentId') tournamentId: number,
    @Body() createMatchesDto: CreateMatchesDto,
  ) {
    return this.riotService.createTournamentMatches(
      tournamentId,
      createMatchesDto,
    );
  }

  @Post('tournaments/match-callback')
  async tournamentMatchCallback(
    @Body() tournamentMatchDto: TournamentMatchDto,
  ) {
    console.log(tournamentMatchDto);
    return { message: 'Callback received' };
  }
}
