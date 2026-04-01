import { Injectable } from '@nestjs/common';
import {
  Guild,
  VoiceChannel,
  TextChannel,
  CategoryChannel,
  PermissionFlagsBits,
  OverwriteType,
  ChannelType,
} from 'discord.js';

export interface MatchChannels {
  waiting: VoiceChannel;
  blue: VoiceChannel;
  red: VoiceChannel;
  text: TextChannel;
}

const VOICE_NAMES = {
  waiting: '| 🕘 | AGUARDANDO',
  blue: 'LADO [ |🔵| ]',
  red: 'LADO [ |🔴| ]',
} as const;

const TEXT_NAME = 'custom_game';
const CATEGORY_KEYWORD = 'personalizada';

@Injectable()
export class ChannelManagerService {
  getMissingChannels(guild: Guild): string[] {
    const missing: string[] = [];
    const voiceNames = new Set(guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice).map((c) => c.name));
    const textExists = guild.channels.cache.some((c) => c.type === ChannelType.GuildText && c.name === TEXT_NAME);

    for (const name of Object.values(VOICE_NAMES)) {
      if (!voiceNames.has(name)) missing.push(name);
    }
    if (!textExists) missing.push(TEXT_NAME);
    return missing;
  }

  getChannels(guild: Guild): MatchChannels | null {
    const waiting = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildVoice && c.name === VOICE_NAMES.waiting,
    ) as VoiceChannel | undefined;
    const blue = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildVoice && c.name === VOICE_NAMES.blue,
    ) as VoiceChannel | undefined;
    const red = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildVoice && c.name === VOICE_NAMES.red,
    ) as VoiceChannel | undefined;
    const text = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === TEXT_NAME,
    ) as TextChannel | undefined;

    if (!waiting || !blue || !red || !text) return null;
    return { waiting, blue, red, text };
  }

  async createChannels(guild: Guild): Promise<MatchChannels> {
    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes(CATEGORY_KEYWORD),
    ) as CategoryChannel | undefined;

    if (!category) {
      category = await guild.channels.create({ name: '🆚 Personalizada', type: ChannelType.GuildCategory });
    }

    const getOrCreate = async (name: string) => {
      const existing = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildVoice && c.name === name,
      ) as VoiceChannel | undefined;
      if (existing) return existing;
      return guild.channels.create({ name, type: ChannelType.GuildVoice, parent: category!.id });
    };

    const [waiting, blue, red] = await Promise.all([
      getOrCreate(VOICE_NAMES.waiting),
      getOrCreate(VOICE_NAMES.blue),
      getOrCreate(VOICE_NAMES.red),
    ]);

    let text = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === TEXT_NAME,
    ) as TextChannel | undefined;

    if (!text) {
      text = await guild.channels.create({
        name: TEXT_NAME,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: '📋 Canal exclusivo para exibição de partidas personalizadas',
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel], type: OverwriteType.Role },
          { id: guild.members.me!.id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel], type: OverwriteType.Member },
        ],
      });
    }

    return { waiting, blue, red, text };
  }

  async moveToChannel(member: any, channel: VoiceChannel | null | undefined): Promise<void> {
    if (!member?.voice?.channel || !channel) return;
    try {
      await member.voice.setChannel(channel);
    } catch {
      // member not in voice or no permission
    }
  }
}
