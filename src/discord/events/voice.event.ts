import { Injectable } from '@nestjs/common';
import { On, Context, ContextOf } from 'necord';
import { LeagueMatchService } from '../../customLeagueMath/leagueMatch.service';

const CHANNEL_NAMES = {
  WAITING: '| 🕘 | AGUARDANDO',
  BLUE: 'LADO [ |🔵| ]',
  RED: 'LADO [ |🔴| ]',
} as const;

@Injectable()
export class VoiceEvent {
  constructor(private readonly leagueMatchService: LeagueMatchService) {}

  @On('voiceStateUpdate')
  async onVoiceStateUpdate(@Context() [oldState, newState]: ContextOf<'voiceStateUpdate'>) {
    // Ignora se o canal não mudou
    if (oldState.channelId === newState.channelId) return;

    const discordId = newState.id;
    const guildId = newState.guild.id;

    const matchId = await this.leagueMatchService.findActiveMatchIdForUser(guildId, discordId);
    if (!matchId) return;

    const channel = newState.channel;
    const channelType = !channel ? null :
      channel.name === CHANNEL_NAMES.WAITING ? 'WAITING' :
      channel.name === CHANNEL_NAMES.BLUE     ? 'BLUE'    :
      channel.name === CHANNEL_NAMES.RED      ? 'RED'     : 'OTHER';

    this.leagueMatchService.emitVoiceStatus(matchId, {
      discordId,
      channelId: channel?.id ?? null,
      channelName: channel?.name ?? null,
      channelType,
    });
  }
}
