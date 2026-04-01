import { Injectable } from '@nestjs/common';
import { GuildMember, VoiceChannel, TextChannel } from 'discord.js';
import { randomUUID } from 'crypto';

export interface OfflineMatchState {
  key: string;
  creatorId: string;
  matchFormatValue: number;
  matchFormatName: string;
  onlineModeValue: number;
  onlineModeName: string;
  guildId: string;
  waitingChannelId: string;
  blueChannelId: string;
  redChannelId: string;
  textChannelId: string;
  confirmedPlayerIds: string[];
  blueTeam: TeamEntry[];
  redTeam: TeamEntry[];
  started: boolean;
  finished: boolean;
  finishing: boolean;
  showDetails: boolean;
  debug: boolean;
  originalChannels: Record<string, string>; // userId -> channelId
  matchId?: number;
  blueTeamId?: number;
  redTeamId?: number;
}

export interface TeamEntry {
  userId: string;
  position?: string;
}

@Injectable()
export class MatchStateService {
  private readonly states = new Map<string, OfflineMatchState>();

  create(partial: Omit<OfflineMatchState, 'key'>): string {
    const key = randomUUID();
    this.states.set(key, { key, ...partial });
    return key;
  }

  get(key: string): OfflineMatchState | undefined {
    return this.states.get(key);
  }

  update(key: string, patch: Partial<OfflineMatchState>): void {
    const state = this.states.get(key);
    if (state) this.states.set(key, { ...state, ...patch });
  }

  delete(key: string): void {
    this.states.delete(key);
  }
}
