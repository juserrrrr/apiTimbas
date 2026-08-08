export const EA_FC_SUPPORTED_PLATFORMS = ['common-gen5'] as const;
export type EaFcPlatform = (typeof EA_FC_SUPPORTED_PLATFORMS)[number];
export type EaFcMatchType = 'friendlyMatch' | 'leagueMatch' | 'playoffMatch';

export interface EaClub {
  externalId: string;
  name: string;
  platform: string;
}

export interface EaClubMember {
  externalPlayerId?: string;
  playerName: string;
  favoritePosition?: string;
  gamesPlayed?: number;
  goals?: number;
  assists?: number;
  manOfTheMatch?: number;
  averageRating?: number;
}

export interface EaClubOverallStats {
  gamesPlayed?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  goalsFor?: number;
  goalsAgainst?: number;
}

export interface EaClubMatchPlayer {
  externalPlayerId?: string;
  playerName: string;
  position?: string;
  rating?: number;
  goals: number;
  assists: number;
  shots?: number;
  passesAttempted?: number;
  passesCompleted?: number;
  tacklesAttempted?: number;
  tacklesCompleted?: number;
  saves?: number;
  manOfTheMatch?: boolean;
}

export interface EaClubMatch {
  externalMatchId: string;
  playedAt: Date;
  homeClubId: string;
  awayClubId: string;
  homeClubName: string;
  awayClubName: string;
  homeScore: number;
  awayScore: number;
  playersByClub: Record<string, EaClubMatchPlayer[]>;
  rawData: Record<string, unknown>;
}

export interface EaGetMatchesOptions {
  matchType?: EaFcMatchType;
  maxResultCount?: number;
}

export type EaExternalRecord = Record<string, unknown>;

export class EaFcPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EaFcPayloadError';
  }
}

export class EaFcProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EaFcProviderError';
  }
}

export class EaFcClubNotFoundError extends EaFcProviderError {
  constructor() {
    super('EA FC club not found', 404);
    this.name = 'EaFcClubNotFoundError';
  }
}
