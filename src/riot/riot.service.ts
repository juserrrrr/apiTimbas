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

const TTL = {
  PLAYER_INFO: 5 * 60 * 1000,       // 5 min — ranked stats mudam com frequência
  SUMMONER: 10 * 60 * 1000,         // 10 min — puuid→summonerId é estável
  DDRAGON_VERSION: 24 * 60 * 60 * 1000, // 24h — patches são quinzenais
  CHAMPIONS: 24 * 60 * 60 * 1000,   // 24h
} as const;

class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

@Injectable()
export class RiotService {
  private readonly playerCache = new TtlCache<any>();
  private readonly summonerCache = new TtlCache<any>();
  private readonly miscCache = new TtlCache<any>();

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
    const key = `account:${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
    const cached = this.miscCache.get(key);
    if (cached) return cached;

    try {
      const data = await this.riotGet<any>(
        `${AMERICAS_BASE}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      );
      this.miscCache.set(key, data, TTL.SUMMONER);
      return data;
    } catch {
      throw new NotFoundException(`Conta ${gameName}#${tagLine} não encontrada`);
    }
  }

  async getSummonerByPuuid(puuid: string) {
    const key = `summoner:${puuid}`;
    const cached = this.summonerCache.get(key);
    if (cached) return cached;

    try {
      const data = await this.riotGet<any>(
        `${BR1_BASE}/lol/summoner/v4/summoners/by-puuid/${puuid}`,
      );
      this.summonerCache.set(key, data, TTL.SUMMONER);
      return data;
    } catch {
      throw new NotFoundException(`Summoner com PUUID ${puuid} não encontrado`);
    }
  }

  async getRankedStats(puuid: string) {
    try {
      return await this.riotGet<any[]>(
        `${BR1_BASE}/lol/league/v4/entries/by-puuid/${puuid}`,
      );
    } catch {
      return [];
    }
  }

  // ─── Combined player info ─────────────────────────────────────────────────

  async getPlayerInfo(gameName: string, tagLine: string) {
    const key = `player:${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
    const cached = this.playerCache.get(key);
    if (cached) return cached;

    const account = await this.getAccount(gameName, tagLine);
    const summoner = await this.getSummonerByPuuid(account.puuid);
    const ranked = await this.getRankedStats(account.puuid);

    const solo = ranked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5') ?? {};
    const flex = ranked.find((r: any) => r.queueType === 'RANKED_FLEX_SR') ?? {};

    const result = {
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

    this.playerCache.set(key, result, TTL.PLAYER_INFO);
    return result;
  }

  async getAccountByPuuid(puuid: string) {
    const key = `account-puuid:${puuid}`;
    const cached = this.miscCache.get(key);
    if (cached) return cached;

    try {
      const data = await this.riotGet<any>(
        `${AMERICAS_BASE}/riot/account/v1/accounts/by-puuid/${puuid}`,
      );
      this.miscCache.set(key, data, TTL.SUMMONER);
      return data;
    } catch {
      throw new NotFoundException(`Account com PUUID ${puuid} não encontrado`);
    }
  }

  async getSummonerById(summonerId: string) {
    const key = `summoner-id:${summonerId}`;
    const cached = this.summonerCache.get(key);
    if (cached) return cached;

    try {
      const data = await this.riotGet<any>(
        `${BR1_BASE}/lol/summoner/v4/summoners/${encodeURIComponent(summonerId)}`,
      );
      this.summonerCache.set(key, data, TTL.SUMMONER);
      return data;
    } catch {
      throw new NotFoundException(`Summoner ${summonerId} não encontrado`);
    }
  }

  async getClashPlayersByPuuid(puuid: string): Promise<any[]> {
    try {
      return await this.riotGet<any[]>(
        `${BR1_BASE}/lol/clash/v1/players/by-puuid/${puuid}`,
      );
    } catch {
      return [];
    }
  }

  async getClashTeam(teamId: string): Promise<any> {
    try {
      return await this.riotGet<any>(`${BR1_BASE}/lol/clash/v1/teams/${encodeURIComponent(teamId)}`);
    } catch {
      throw new NotFoundException(`Time de Clash ${teamId} não encontrado`);
    }
  }

  async getMatchHistory(puuid: string, count = 20, queueId?: number): Promise<string[]> {
    try {
      let url = `${AMERICAS_BASE}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`;
      if (queueId) url += `&queue=${queueId}`;
      return await this.riotGet<string[]>(url);
    } catch {
      return [];
    }
  }

  async getMatch(matchId: string): Promise<any> {
    const key = `match:${matchId}`;
    const cached = this.miscCache.get(key);
    if (cached) return cached;

    try {
      const data = await this.riotGet<any>(
        `${AMERICAS_BASE}/lol/match/v5/matches/${matchId}`,
      );
      this.miscCache.set(key, data, 60 * 60 * 1000);
      return data;
    } catch {
      return null;
    }
  }

  async getChampionMastery(puuid: string, count = 10): Promise<any[]> {
    try {
      return await this.riotGet<any[]>(
        `${BR1_BASE}/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${count}`,
      );
    } catch {
      return [];
    }
  }

  async getChampionIdNameMap(): Promise<Map<number, string>> {
    const cached = this.miscCache.get('ddragon:id-name-map');
    if (cached) return cached;

    try {
      const version = await this.getDdragonVersion();
      const { data } = await firstValueFrom(
        this.httpService
          .get<any>(`${DDRAGON_BASE}/cdn/${version}/data/pt_BR/champion.json`)
          .pipe(catchError(() => { throw new Error(); })),
      );
      const map = new Map<number, string>();
      for (const champ of Object.values(data.data) as any[]) {
        map.set(Number(champ.key), champ.id);
      }
      this.miscCache.set('ddragon:id-name-map', map, TTL.CHAMPIONS);
      return map;
    } catch {
      return new Map();
    }
  }

  async getSummonerCurrentIcon(puuid: string): Promise<number> {
    const summoner = await this.riotGet<any>(
      `${BR1_BASE}/lol/summoner/v4/summoners/by-puuid/${puuid}`,
    );
    return summoner.profileIconId as number;
  }

  // ─── Account verification ─────────────────────────────────────────────────

  // Não usa cache — precisa de dados frescos para verificar a troca de ícone
  async verifyIcon(puuid: string, iconId: number): Promise<{ verified: boolean }> {
    try {
      const summoner = await this.riotGet<any>(
        `${BR1_BASE}/lol/summoner/v4/summoners/by-puuid/${puuid}`,
      );
      return { verified: summoner.profileIconId === iconId };
    } catch {
      return { verified: false };
    }
  }

  // ─── Data Dragon ──────────────────────────────────────────────────────────

  private async getDdragonVersion(): Promise<string> {
    const cached = this.miscCache.get('ddragon:version');
    if (cached) return cached;

    try {
      const { data } = await firstValueFrom(
        this.httpService
          .get<string[]>(`${DDRAGON_BASE}/api/versions.json`)
          .pipe(catchError(() => { throw new Error(); })),
      );
      const version = data[0];
      this.miscCache.set('ddragon:version', version, TTL.DDRAGON_VERSION);
      return version;
    } catch {
      return '15.6.1';
    }
  }

  async getAllChampions(): Promise<string[]> {
    const cached = this.miscCache.get('ddragon:champions');
    if (cached) return cached;

    const version = await this.getDdragonVersion();
    const { data } = await firstValueFrom(
      this.httpService
        .get<any>(`${DDRAGON_BASE}/cdn/${version}/data/pt_BR/champion.json`)
        .pipe(catchError(() => { throw new Error('Falha ao buscar campeões'); })),
    );
    const champions = Object.keys(data.data);
    this.miscCache.set('ddragon:champions', champions, TTL.CHAMPIONS);
    return champions;
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
