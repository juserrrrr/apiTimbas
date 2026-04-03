import { Injectable, Logger } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext, IntegerOption, BooleanOption } from 'necord';
import {
  Client,
  GuildMember,
  MessageFlags,
} from 'discord.js';
import * as path from 'path';
import * as fs from 'fs';
import { ChannelManagerService } from '../services/channel-manager.service';
import { MatchStateService } from '../services/match-state.service';
import { LeagueMatchService } from '../../customLeagueMath/leagueMatch.service';
import { buildMatchEmbed } from '../helpers/embed.helper';
import { buildOfflineMatchButtons } from '../helpers/match-buttons.helper';
import { MatchType } from '@prisma/client';

const FORMAT_NAMES: Record<number, string> = { 0: 'Aleatório', 1: 'Livre', 3: 'Aleatório Completo' };
const FORMAT_API: Record<number, MatchType> = { 0: MatchType.ALEATORIO, 1: MatchType.LIVRE, 3: MatchType.ALEATORIO_COMPLETO };
const MODE_NAMES: Record<number, string> = { 0: 'Offline', 1: 'Online' };

class CriarPartidaOptions {
  @IntegerOption({
    name: 'modo',
    description: 'Online (com registro) ou Offline (sem registro)',
    required: true,
    choices: [
      { name: 'Online', value: 1 },
      { name: 'Offline', value: 0 },
    ],
  })
  onlineMode: number;

  @IntegerOption({
    name: 'tamanho',
    description: 'Quantos jogadores por time',
    required: true,
    choices: [
      { name: '1v1', value: 1 },
      { name: '3v3', value: 3 },
      { name: '5v5', value: 5 },
    ],
  })
  playersPerTeam: number;

  @IntegerOption({
    name: 'formato',
    description: 'Como os times serão formados',
    required: true,
    choices: [
      { name: 'Aleatório', value: 0 },
      { name: 'Livre', value: 1 },
      { name: 'Aleatório Completo (apenas 5v5)', value: 3 },
    ],
  })
  matchFormat: number;

  @BooleanOption({ name: 'debug', description: 'Modo de debug com jogadores falsos (apenas dono)', required: false })
  debug?: boolean;
}

@Injectable()
export class CriarPartidaCommand {
  private readonly logger = new Logger(CriarPartidaCommand.name);

  constructor(
    private readonly client: Client,
    private readonly channelManager: ChannelManagerService,
    private readonly matchStateService: MatchStateService,
    private readonly leagueMatchService: LeagueMatchService,
  ) {}

  private getGifAttachment() {
    const gifPath = path.join(process.cwd(), 'images', 'timbasQueueGif.gif');
    if (fs.existsSync(gifPath)) return { attachment: gifPath, name: 'timbas.gif' };
    return null;
  }

  @SlashCommand({ name: 'criarpartida', description: 'Cria uma partida personalizada de League of Legends.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onCriarPartida(
    @Context() [interaction]: SlashCommandContext,
    @Options() { onlineMode, playersPerTeam, matchFormat, debug }: CriarPartidaOptions,
  ) {
    const member = interaction.member as GuildMember;

    if (debug && interaction.user.id !== interaction.guild!.ownerId) {
      await interaction.reply({ content: '❌ Você não tem permissão para usar o modo de debug.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (matchFormat === 3 && playersPerTeam !== 5) {
      await interaction.reply({ content: '❌ O modo Aleatório Completo só está disponível para 5v5.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Channel management
    const missing = this.channelManager.getMissingChannels(interaction.guild!);
    if (missing.length) {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
      const confirmRow = new ActionRowBuilder<InstanceType<typeof ButtonBuilder>>().addComponents(
        new ButtonBuilder().setCustomId('ch/create/confirm').setLabel('Sim, criar canais').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ch/create/cancel').setLabel('Não, cancelar').setStyle(ButtonStyle.Danger),
      );
      const promptMsg = await interaction.followUp({ content: 'Canais para a partida não encontrados. Deseja criá-los?', components: [confirmRow as any], flags: MessageFlags.Ephemeral, fetchReply: true });

      const collector = promptMsg.createMessageComponentCollector({ time: 60_000, max: 1 });
      const result = await new Promise<boolean>((resolve) => {
        collector.on('collect', async (i) => { await i.deferUpdate(); resolve(i.customId === 'ch/create/confirm'); });
        collector.on('end', (_, reason) => { if (reason === 'time') resolve(false); });
      });

      if (!result) {
        await interaction.editReply({ content: 'Criação de canais cancelada.', components: [] });
        return;
      }

      await interaction.editReply({ content: 'Criando canais...', components: [] });
      await this.channelManager.createChannels(interaction.guild!);
      await interaction.editReply({ content: 'Canais criados com sucesso!', components: [] });
    }

    const channels = this.channelManager.getChannels(interaction.guild!)!;

    if (onlineMode === 1) {
      await this.createOnlineLobby(interaction, matchFormat, playersPerTeam, channels);
    } else {
      await this.createOfflineMatch(interaction, matchFormat, playersPerTeam, channels, debug ?? false);
    }
  }

  private async createOnlineLobby(interaction: any, matchFormat: number, playersPerTeam: number, channels: any) {
    try {
      const lobby = await this.leagueMatchService.createOnline({
        discordServerId: interaction.guild.id,
        creatorDiscordId: interaction.user.id,
        matchFormat: FORMAT_API[matchFormat],
        playersPerTeam,
      });

      const webUrl = `${process.env.WEB_URL ?? 'http://localhost:3000'}/dashboard/match/${lobby.id}`;

      // Announce embed to the custom_game channel
      await this.leagueMatchService.announceMatchToGuild(
        lobby.id,
        interaction.guild.id,
        FORMAT_API[matchFormat],
        playersPerTeam,
      );

      const msg = await interaction.followUp({
        content: `✅ Partida ${playersPerTeam}v${playersPerTeam} criada! Veja em ${channels.text}\n🌐 Ao vivo: ${webUrl}`,
        flags: MessageFlags.Ephemeral,
        fetchReply: true,
      });
      setTimeout(() => msg.delete().catch(() => {}), 8000);
    } catch (e) {
      this.logger.error(`Error creating online lobby: ${e}`);
      const msg = await interaction.followUp({ content: '❌ Erro inesperado ao criar a partida. Tente novamente.', flags: MessageFlags.Ephemeral, fetchReply: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
    }
  }

  private async createOfflineMatch(interaction: any, matchFormat: number, playersPerTeam: number, channels: any, debug: boolean) {
    let initialPlayers: string[] = [];

    if (debug) {
      const debugPlayers = [
        '919276824578646068', '352240724693090305', '373887997826957312',
        '1089165750993948774', '209825857815052288', '343492133644140544',
        '191630723935895553', '214397364163706880', '430165932963266561',
        '635277051439611914',
      ];
      initialPlayers = debugPlayers.slice(0, playersPerTeam * 2);
    }

    const key = this.matchStateService.create({
      creatorId: interaction.user.id,
      matchFormatValue: matchFormat,
      matchFormatName: FORMAT_NAMES[matchFormat],
      onlineModeValue: 0,
      onlineModeName: 'Offline',
      playersPerTeam,
      guildId: interaction.guild.id,
      waitingChannelId: channels.waiting.id,
      blueChannelId: channels.blue.id,
      redChannelId: channels.red.id,
      textChannelId: channels.text.id,
      confirmedPlayerIds: initialPlayers,
      blueTeam: [],
      redTeam: [],
      started: false,
      finished: false,
      finishing: false,
      showDetails: false,
      debug,
      originalChannels: {},
    });

    const gif = this.getGifAttachment();
    const files = gif ? [gif] : [];
    const embed = buildMatchEmbed([], [], FORMAT_NAMES[matchFormat], 'Offline', `Aguardando jogadores... 0/${playersPerTeam * 2}`, undefined, null, false, !!gif, playersPerTeam);
    const buttons = buildOfflineMatchButtons(key, false, matchFormat, initialPlayers.length, false, playersPerTeam);

    await channels.text.send({ embeds: [embed], components: buttons, files });

    const msg = await interaction.followUp({
      content: `Partida ${playersPerTeam}v${playersPerTeam} offline criada! Veja em ${channels.text}`,
      flags: MessageFlags.Ephemeral,
      fetchReply: true,
    });
    setTimeout(() => msg.delete().catch(() => {}), 5000);
  }
}
