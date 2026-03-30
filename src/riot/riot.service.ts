import { Injectable, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { catchError, firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { CreateProviderDto } from './dto/create-provider.dto';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { CreateMatchesDto } from './dto/create-matches.dto';
import { TournamentMatchDto } from './dto/tournament-match.dto';

const AMERICAS_BASE = 'https://americas.api.riotgames.com';
const BR1_BASE = 'https://br1.api.riotgames.com';
const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com';

@Injectable()
export class RiotService {
  constructor(private readonly httpService: HttpService) {}

  private get riotHeaders() {
    return { 'X-Riot-Token': process.env.RIOT_API_KEY };
  }

  private async riotGet<T>(absoluteUrl: string): Promise<T> {
    const { data } = await firstValueFrom(
      this.httpService
        .get<T>(absoluteUrl, { headers: this.riotHeaders })
        .pipe(
          catchError((error: AxiosError) => {
            throw error;
          }),
        ),
    );
    return data;
  }

  // ─── LoL Account (Riot ID) ────────────────────────────────────────────────

  async getAccount(gameName: string, tagLine: string) {
    try {
      return await this.riotGet<any>(
        `${AMERICAS_BASE}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      );
    } catch {
      throw new NotFoundException(`Conta ${gameName}#${tagLine} não encontrada`);
    }
  }

  async getSummonerByPuuid(puuid: string) {
    try {
      return await this.riotGet<any>(
        `${BR1_BASE}/lol/summoner/v4/summoners/by-puuid/${puuid}`,
      );
    } catch {
      throw new NotFoundException(`Summoner com PUUID ${puuid} não encontrado`);
    }
  }

  async getRankedStats(summonerId: string) {
    try {
      return await this.riotGet<any[]>(
        `${BR1_BASE}/lol/league/v4/entries/by-summoner/${summonerId}`,
      );
    } catch {
      return [];
    }
  }

  // ─── Combined player info ─────────────────────────────────────────────────

  async getPlayerInfo(gameName: string, tagLine: string) {
    const account = await this.getAccount(gameName, tagLine);
    const summoner = await this.getSummonerByPuuid(account.puuid);
    const ranked = await this.getRankedStats(summoner.id);

    const solo = ranked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5') ?? {};
    const flex = ranked.find((r: any) => r.queueType === 'RANKED_FLEX_SR') ?? {};

    return {
      puuid: account.puuid,
      gameName: account.gameName,
      tagLine: account.tagLine,
      summonerId: summoner.id,
      summonerLevel: summoner.summonerLevel,
      profileIconId: summoner.profileIconId,
      profileIconUrl: this.buildProfileIconUrl(summoner.profileIconId),
      solo: {
        tier: solo.tier ?? 'Unranked',
        rank: solo.rank ?? '',
        lp: solo.leaguePoints ?? 0,
        wins: solo.wins ?? 0,
        losses: solo.losses ?? 0,
      },
      flex: {
        tier: flex.tier ?? 'Unranked',
        rank: flex.rank ?? '',
        lp: flex.leaguePoints ?? 0,
        wins: flex.wins ?? 0,
        losses: flex.losses ?? 0,
      },
    };
  }

  // ─── Account verification ─────────────────────────────────────────────────

  async verifyIcon(puuid: string, iconId: number): Promise<{ verified: boolean }> {
    try {
      const summoner = await this.getSummonerByPuuid(puuid);
      return { verified: summoner.profileIconId === iconId };
    } catch {
      return { verified: false };
    }
  }

  // ─── Data Dragon ──────────────────────────────────────────────────────────

  private async getDdragonVersion(): Promise<string> {
    try {
      const { data } = await firstValueFrom(
        this.httpService
          .get<string[]>(`${DDRAGON_BASE}/api/versions.json`)
          .pipe(catchError(() => { throw new Error(); })),
      );
      return data[0];
    } catch {
      return '15.6.1';
    }
  }

  async getAllChampions(): Promise<string[]> {
    const version = await this.getDdragonVersion();
    const { data } = await firstValueFrom(
      this.httpService
        .get<any>(`${DDRAGON_BASE}/cdn/${version}/data/pt_BR/champion.json`)
        .pipe(catchError(() => { throw new Error('Falha ao buscar campeões'); })),
    );
    return Object.keys(data.data);
  }

  buildProfileIconUrl(iconId: number): string {
    return `http://ddragon.leagueoflegends.com/cdn/img/profileicon/${iconId}.png`;
  }

  async buildChampionIconUrl(championName: string): Promise<string> {
    const version = await this.getDdragonVersion();
    return `${DDRAGON_BASE}/cdn/${version}/img/champion/${championName}.png`;
  }

  // ─── Tournament ───────────────────────────────────────────────────────────

  async getSummonerByName(summonerName: string) {
    return await this.riotGet<any>(
      `${BR1_BASE}/lol/summoner/v4/summoners/by-name/${encodeURIComponent(summonerName)}`,
    );
  }

  async createTournamentProvider(createProviderDto: CreateProviderDto) {
    const { data } = await firstValueFrom(
      this.httpService
        .post<any>(`${BR1_BASE}/lol/tournament-stub/v5/providers`, createProviderDto, {
          headers: this.riotHeaders,
        })
        .pipe(catchError((e: AxiosError) => { throw e; })),
    );
    return data;
  }

  async createTournament(createTournamentDto: CreateTournamentDto) {
    const { data } = await firstValueFrom(
      this.httpService
        .post<any>(`${BR1_BASE}/lol/tournament-stub/v5/tournaments`, createTournamentDto, {
          headers: this.riotHeaders,
        })
        .pipe(catchError((e: AxiosError) => { throw e; })),
    );
    return data;
  }

  async createTournamentMatches(tournamentId: number, createMatchesDto: CreateMatchesDto) {
    const { data } = await firstValueFrom(
      this.httpService
        .post<any>(
          `${BR1_BASE}/lol/tournament-stub/v5/matches/by-tournament/${tournamentId}`,
          createMatchesDto,
          { headers: this.riotHeaders },
        )
        .pipe(catchError((e: AxiosError) => { throw e; })),
    );
    return data;
  }

  async handleMatchCallback(tournamentMatchDto: TournamentMatchDto) {
    return { message: 'Callback received', data: tournamentMatchDto };
  }
}
