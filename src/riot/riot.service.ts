import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { catchError, firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { CreateProviderDto } from './dto/create-provider.dto';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { CreateMatchesDto } from './dto/create-matches.dto';

@Injectable()
export class RiotService {
  constructor(private readonly httpService: HttpService) {}

  async getSummonerByName(summonerName: string) {
    const url = `/lol/summoner/v4/summoners/by-name/${summonerName}`;
    const { data } = await firstValueFrom(
      this.httpService.get<any>(url).pipe(
        catchError((error: AxiosError) => {
          console.error(error.response.data);
          throw 'An error happened!';
        }),
      ),
    );
    return data;
  }

  async createTournamentProvider(createProviderDto: CreateProviderDto) {
    const url = '/lol/tournament-stub/v5/providers';
    const { data } = await firstValueFrom(
      this.httpService.post<any>(url, createProviderDto).pipe(
        catchError((error: AxiosError) => {
          console.error(error.response.data);
          throw 'An error happened!';
        }),
      ),
    );
    return data;
  }

  async createTournament(createTournamentDto: CreateTournamentDto) {
    const url = '/lol/tournament-stub/v5/tournaments';
    const { data } = await firstValueFrom(
      this.httpService.post<any>(url, createTournamentDto).pipe(
        catchError((error: AxiosError) => {
          console.error(error.response.data);
          throw 'An error happened!';
        }),
      ),
    );
    return data;
  }

  async createTournamentMatches(
    tournamentId: number,
    createMatchesDto: CreateMatchesDto,
  ) {
    const url = `/lol/tournament-stub/v5/matches/by-tournament/${tournamentId}`;
    const { data } = await firstValueFrom(
      this.httpService.post<any>(url, createMatchesDto).pipe(
        catchError((error: AxiosError) => {
          console.error(error.response.data);
          throw 'An error happened!';
        }),
      ),
    );
    return data;
  }
}
