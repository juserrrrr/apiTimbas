import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  UseGuards,
  Headers,
  UnauthorizedException,
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
@Roles(Role.ADMIN)
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
