import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Client, VoiceChannel, ChannelType } from 'discord.js';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { ChannelManagerService } from '../services/channel-manager.service';
import { Role } from '../../enums/role.enum';

const CHANNEL_NAMES = {
  WAITING: '| 🕘 | AGUARDANDO',
  BLUE: 'LADO [ |🔵| ]',
  RED: 'LADO [ |🔴| ]',
} as const;

type VoiceTarget = 'WAITING' | 'BLUE' | 'RED';

@Controller('discord/voice')
@UseGuards(AuthGuard)
export class DiscordVoiceController {
  constructor(
    private readonly client: Client,
    private readonly channelManager: ChannelManagerService,
  ) {}

  @Get('status')
  async getStatus(
    @Query('guildId') guildId: string,
    @Query('discordId') discordId: string,
    @Req() req: any,
  ) {
    if (!guildId || !discordId) throw new BadRequestException('guildId e discordId são obrigatórios.');

    const payload = req.tokenPayload;
    if (payload?.role !== Role.ADMIN && payload?.role !== Role.BOT && payload?.discordId !== discordId) {
      console.error('[DiscordVoiceController] Unauthorized: payload discordId mismatch', { payload: payload?.discordId, discordId });
      throw new UnauthorizedException('Você só pode consultar seu próprio status de voz.');
    }

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return { channelId: null, channelName: null, channelType: null };

    let member = guild.members.cache.get(discordId);
    if (!member) {
      try {
        member = await guild.members.fetch(discordId);
      } catch (e) {
        console.error('[DiscordVoiceController] Erro ao dar fetch no membro:', e.message);
        member = undefined;
      }
    }

    const channel = (member as any)?.voice?.channel as VoiceChannel | null;
    if (!channel) return { channelId: null, channelName: null, channelType: null };

    const channelType: string =
      channel.name === CHANNEL_NAMES.WAITING ? 'WAITING' :
      channel.name === CHANNEL_NAMES.BLUE     ? 'BLUE'    :
      channel.name === CHANNEL_NAMES.RED      ? 'RED'     :
      'OTHER';

    return {
      channelId: channel.id,
      channelName: channel.name,
      channelType,
    };
  }

  @Post('move')
  async moveToChannel(
    @Body() body: { guildId: string; discordId: string; target: VoiceTarget },
    @Req() req: any,
  ) {
    const { guildId, discordId, target } = body;
    if (!guildId || !discordId || !target) throw new BadRequestException('guildId, discordId e target são obrigatórios.');

    const payload = req.tokenPayload;
    if (payload?.role !== Role.ADMIN && payload?.role !== Role.BOT && payload?.discordId !== discordId) {
      throw new UnauthorizedException('Você só pode mover a si mesmo.');
    }

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new NotFoundException('Servidor Discord não encontrado.');

    const targetChannel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildVoice && c.name === CHANNEL_NAMES[target],
    ) as VoiceChannel | undefined;
    if (!targetChannel) throw new NotFoundException(`Canal ${target} não encontrado no servidor.`);

    let member = guild.members.cache.get(discordId);
    if (!member) {
      member = await guild.members.fetch(discordId).catch(() => undefined);
    }

    if (!member) throw new NotFoundException('Membro não encontrado no servidor.');
    if (!(member as any)?.voice?.channel) throw new BadRequestException('Você precisa estar em um canal de voz para ser movido.');

    await this.channelManager.moveToChannel(member, targetChannel);
    return { success: true, channelName: targetChannel.name };
  }
}
