import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import {
  mapEaClub,
  mapEaClubSearchResult,
  mapEaClubOverallStats,
  mapEaClubMemberStats,
  mapEaMatch,
  mapEaMember,
} from './ea-fc-clubs.mapper';
import {
  parseClubPayload,
  parseClubSearchPayload,
  parseMatchesPayload,
  parseMembersPayload,
  parseOverallStatsPayload,
} from './ea-fc-clubs.schemas';
import {
  EaClub,
  EaClubMatch,
  EaClubMember,
  EaClubMemberStats,
  EaClubOverallStats,
  EaFcClubNotFoundError,
  EaFcMatchType,
  EaFcPayloadError,
  EaFcPlatform,
  EaFcProviderError,
  EaGetMatchesOptions,
} from './ea-fc-clubs.types';

const MATCH_TYPES: EaFcMatchType[] = [
  'friendlyMatch',
  'leagueMatch',
  'playoffMatch',
];

class RequestRateGate {
  private nextAvailableAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly intervalMs: number) {}

  acquire(): Promise<void> {
    const current = this.queue.then(async () => {
      const waitMs = Math.max(0, this.nextAvailableAt - Date.now());
      if (waitMs) {
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
      this.nextAvailableAt = Date.now() + this.intervalMs;
    });
    this.queue = current.catch(() => undefined);
    return current;
  }
}

@Injectable()
export class EaFcClubsProvider {
  private readonly logger = new Logger(EaFcClubsProvider.name);
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxResults: number;
  private readonly rateGate: RequestRateGate;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.timeoutMs = Number(config.get('EA_FC_TIMEOUT_MS') ?? 10000);
    this.maxRetries = Number(config.get('EA_FC_MAX_RETRIES') ?? 2);
    this.maxResults = Math.min(
      100,
      Math.max(1, Number(config.get('EA_FC_MAX_RESULTS') ?? 100)),
    );
    const requestsPerSecond = Math.max(
      1,
      Number(config.get('EA_FC_REQUESTS_PER_SECOND') ?? 4),
    );
    this.rateGate = new RequestRateGate(Math.ceil(1000 / requestsPerSecond));
  }

  async getClub(clubId: string, platform: EaFcPlatform): Promise<EaClub> {
    const payload = parseClubPayload(
      await this.request('clubs/info', { platform, clubIds: clubId }),
    );
    try {
      return mapEaClub(payload, clubId, platform);
    } catch (error) {
      if (
        error instanceof EaFcPayloadError &&
        Object.keys(payload).length === 0
      ) {
        throw new EaFcClubNotFoundError();
      }
      throw error;
    }
  }

  async searchClubs(name: string, platform: EaFcPlatform): Promise<EaClub[]> {
    const payload = await this.request('allTimeLeaderboard/search', {
      platform,
      clubName: name,
    });
    return parseClubSearchPayload(payload).map((club) =>
      mapEaClubSearchResult(club, platform),
    );
  }

  async getClubMembers(
    clubId: string,
    platform: EaFcPlatform,
  ): Promise<EaClubMember[]> {
    const payload = await this.request('members/career/stats', {
      platform,
      clubId,
    });
    return parseMembersPayload(payload).map(mapEaMember);
  }

  async getClubOverallStats(
    clubId: string,
    platform: EaFcPlatform,
  ): Promise<EaClubOverallStats> {
    const payload = await this.request('clubs/overallStats', {
      platform,
      clubIds: clubId,
    });
    return mapEaClubOverallStats(parseOverallStatsPayload(payload));
  }

  async getClubMemberStats(
    clubId: string,
    platform: EaFcPlatform,
  ): Promise<EaClubMemberStats[]> {
    const payload = await this.request('members/stats', {
      platform,
      clubId,
    });
    return parseMembersPayload(payload).map(mapEaClubMemberStats);
  }

  async getClubMatches(
    clubId: string,
    platform: EaFcPlatform,
    options: EaGetMatchesOptions = {},
  ): Promise<EaClubMatch[]> {
    const payload = await this.request('clubs/matches', {
      platform,
      clubIds: clubId,
      matchType: options.matchType ?? 'friendlyMatch',
      maxResultCount: Math.min(
        Math.max(options.maxResultCount ?? this.maxResults, 1),
        100,
      ),
    });
    return parseMatchesPayload(payload).map(mapEaMatch);
  }

  async getRecentMatches(
    clubId: string,
    platform: EaFcPlatform,
  ): Promise<EaClubMatch[]> {
    const matches: EaClubMatch[] = [];
    let successfulCalls = 0;
    let lastError: unknown;
    for (const matchType of MATCH_TYPES) {
      try {
        matches.push(
          ...(await this.getClubMatches(clubId, platform, { matchType })),
        );
        successfulCalls += 1;
      } catch (error) {
        lastError = error;
        this.logger.warn(`EA match window ${matchType} could not be fetched`);
      }
    }
    if (successfulCalls === 0) throw lastError;
    return Array.from(
      new Map(matches.map((match) => [match.externalMatchId, match])).values(),
    ).sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime());
  }

  async getMatch(
    clubId: string,
    platform: EaFcPlatform,
    externalMatchId: string,
  ): Promise<EaClubMatch | undefined> {
    const matches = await this.getRecentMatches(clubId, platform);
    return matches.find((match) => match.externalMatchId === externalMatchId);
  }

  private async request(
    endpoint: string,
    params: Record<string, string | number>,
  ): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.rateGate.acquire();
      try {
        const response = await firstValueFrom(
          this.http.get<unknown>(endpoint, {
            params,
            timeout: this.timeoutMs,
            headers: {
              Accept: 'application/json',
              'User-Agent': 'Timbas-EA-FC-Clubs/1.0',
            },
          }),
        );
        return response.data;
      } catch (error) {
        lastError = error;
        const status = (error as AxiosError).response?.status;
        if (status === 404) throw new EaFcClubNotFoundError();
        if (!this.shouldRetry(error) || attempt === this.maxRetries) break;
        const delay = this.retryDelay(error as AxiosError, attempt);
        this.logger.warn(
          `EA request ${endpoint} failed with ${status ?? 'network error'}; retrying`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
    const status = (lastError as AxiosError | undefined)?.response?.status;
    throw new EaFcProviderError(
      status === 429
        ? 'EA FC Clubs rate limit exceeded'
        : 'EA FC Clubs is temporarily unavailable',
      status,
    );
  }

  private shouldRetry(error: unknown): boolean {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    return !status || status === 429 || status >= 500;
  }

  private retryDelay(error: AxiosError, attempt: number): number {
    const response = error.response as AxiosResponse | undefined;
    const retryAfter = Number(response?.headers?.['retry-after']);
    if (Number.isFinite(retryAfter) && retryAfter >= 0) {
      return Math.min(retryAfter * 1000, 10000);
    }
    return Math.min(500 * 2 ** attempt, 4000);
  }
}
