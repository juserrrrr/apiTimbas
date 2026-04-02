import { Injectable, Logger } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext, IntegerOption, BooleanOption } from 'necord';
import {
  Client,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder,
  GuildMember,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import * as path from 'path';
import * as fs from 'fs';
import { ChannelManagerService } from '../services/channel-manager.service';
import { MatchStateService } from '../services/match-state.service';
import { LeagueMatchService } from '../../customLeagueMath/leagueMatch.service';
import { generateLeagueEmbedText } from '../helpers/embed.helper';
import { drawTeams, drawTeamsWithPositions } from '../helpers/team.helper';

const FORMAT_NAMES: Record<number, string> = { 0: 'Aleatório', 1: 'Livre', 3: 'Aleatório Completo' };
const FORMAT_API: Record<number, string> = { 0: 'ALEATORIO', 1: 'LIVRE', 3: 'ALEATORIO_COMPLETO' };
const MODE_NAMES: Record<number, string> = { 0: 'Offline', 1: 'Online' };

class CriarPersonOptions {
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
    name: 'formato',
    description: 'Como os times serão formados',
    required: true,
    choices: [
      { name: 'Aleatório', value: 0 },
      { name: 'Livre', value: 1 },
      { name: 'Aleatório Completo', value: 3 },
    ],
  })
  matchFormat: number;

  @BooleanOption({ name: 'debug', description: 'Modo de debug com jogadores falsos (apenas dono)', required: false })
  debug?: boolean;
}

export function buildOfflineMatchButtons(key: string, started: boolean, matchFormatValue: number, playerCount: number, finished: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (!started) {
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`cm/join/${key}`).setLabel('Entrar').setStyle(ButtonStyle.Success).setEmoji('✅').setDisabled(finished || playerCount >= 10),
      new ButtonBuilder().setCustomId(`cm/leave/${key}`).setLabel('Sair').setStyle(ButtonStyle.Danger).setEmoji('🚪').setDisabled(finished),
      new ButtonBuilder().setCustomId(`cm/count/${key}`).setLabel(`Confirmados: ${playerCount}/10`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    );
    rows.push(row1);

    const row2 = new ActionRowBuilder<ButtonBuilder>();
    if (matchFormatValue === 0 || matchFormatValue === 3) {
      row2.addComponents(new ButtonBuilder().setCustomId(`cm/draw/${key}`).setLabel('Sortear').setStyle(ButtonStyle.Primary).setEmoji('🎲').setDisabled(playerCount < 10 || finished));
    } else if (matchFormatValue === 1) {
      row2.addComponents(new ButtonBuilder().setCustomId(`cm/switch/${key}`).setLabel('Trocar Lado').setStyle(ButtonStyle.Primary).setEmoji('🔄').setDisabled(playerCount !== 10 || finished));
    }
    row2.addComponents(
      new ButtonBuilder().setCustomId(`cm/start/${key}`).setLabel('Iniciar').setStyle(ButtonStyle.Success).setEmoji('▶').setDisabled(playerCount !== 10 || finished),
      new ButtonBuilder().setCustomId(`cm/finish/${key}`).setLabel('Finalizar').setStyle(ButtonStyle.Danger).setEmoji('🏁').setDisabled(true),
    );
    if (row2.components.length) rows.push(row2);
  } else {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`cm/rejoin/${key}`).setLabel('Voltar para a Sala').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
      new ButtonBuilder().setCustomId(`cm/finish/${key}`).setLabel('Finalizar').setStyle(ButtonStyle.Danger).setEmoji('🏁').setDisabled(finished),
    );
    rows.push(row);
  }

  return rows;
}

export function buildOnlineLobbyButtons(lobbyId: number | string, started: boolean, finished: boolean, matchFormatValue: number): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ol/join/${lobbyId}`).setLabel('Entrar').setStyle(ButtonStyle.Success).setEmoji('✅').setDisabled(started || finished),
    new ButtonBuilder().setCustomId(`ol/leave/${lobbyId}`).setLabel('Sair').setStyle(ButtonStyle.Danger).setEmoji('🚪').setDisabled(started || finished),
    new ButtonBuilder().setCustomId(`ol/draw/${lobbyId}`).setLabel('Sortear').setStyle(ButtonStyle.Primary).setEmoji('🎲').setDisabled(started || finished || matchFormatValue === 1),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ol/start/${lobbyId}`).setLabel('Iniciar').setStyle(ButtonStyle.Success).setEmoji('▶').setDisabled(started || finished),
    new ButtonBuilder().setCustomId(`ol/finish/${lobbyId}`).setLabel('Finalizar').setStyle(ButtonStyle.Danger).setEmoji('🏁').setDisabled(finished),
  );
  return [row1, row2];
}

export function buildMatchEmbed(
  blueTeam: any[],
  redTeam: any[],
  matchFormat: string,
  onlineMode: string,
  footerText: string,
  webUrl?: string,
  winner?: 'BLUE' | 'RED' | null,
  showDetails = false,
  withGif = false,
): EmbedBuilder {
  const text = generateLeagueEmbedText(blueTeam, redTeam, matchFormat, onlineMode, winner, showDetails);
  const embed = new EmbedBuilder()
    .setDescription('```' + text + '```')
    .setColor(0x5865f2)
    .setFooter({ text: footerText });
  if (withGif) embed.setImage('attachment://timbas.gif');
  if (webUrl) {
    embed.addFields({ name: '\u200b', value: `[Acompanhe pelo site](${webUrl})`, inline: false });
  }
  return embed;
}

@Injectable()
export class CriarPersonalizadaCommand {
  private readonly logger = new Logger(CriarPersonalizadaCommand.name);

  constructor(
    private readonly client: Client,
    private readonly channelManager: ChannelManagerService,
    private readonly matchStateService: MatchStateService,
    private readonly leagueMatchService: LeagueMatchService,
  ) {}

  private getGifAttachment(): AttachmentBuilder | null {
    const gifPath = path.join(process.cwd(), 'images', 'timbasQueueGif.gif');
    if (fs.existsSync(gifPath)) return new AttachmentBuilder(gifPath, { name: 'timbas.gif' });
    return null;
  }

  @SlashCommand({ name: 'criarperson', description: 'Cria uma partida personalizada de League of Legends.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onCriarPerson(
    @Context() [interaction]: SlashCommandContext,
    @Options() { onlineMode, matchFormat, debug }: CriarPersonOptions,
  ) {
    const member = interaction.member as GuildMember;

    if (debug && interaction.user.id !== interaction.guild!.ownerId) {
      await interaction.reply({ content: '❌ Você não tem permissão para usar o modo de debug.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (matchFormat === 2) {
      await interaction.reply({ content: 'O modo Balanceado ainda está em desenvolvimento.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Channel management
    const missing = this.channelManager.getMissingChannels(interaction.guild!);
    if (missing.length) {
      const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('ch/create/confirm').setLabel('Sim, criar canais').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ch/create/cancel').setLabel('Não, cancelar').setStyle(ButtonStyle.Danger),
      );
      const promptMsg = await interaction.followUp({ content: 'Canais para a partida não encontrados. Deseja criá-los?', components: [confirmRow], flags: MessageFlags.Ephemeral, fetchReply: true });

      const collector = promptMsg.createMessageComponentCollector({ time: 60_000, max: 1 });
      const result = await new Promise<boolean>((resolve) => {
        collector.on('collect', async (i) => {
          await i.deferUpdate();
          resolve(i.customId === 'ch/create/confirm');
        });
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
      await this.createOnlineLobby(interaction, matchFormat, channels, debug ?? false);
    } else {
      await this.createOfflineMatch(interaction, matchFormat, channels, debug ?? false);
    }
  }

  private async createOnlineLobby(interaction: any, matchFormat: number, channels: any, debug: boolean) {
    try {
      const lobby = await this.leagueMatchService.createOnline({
        discordServerId: interaction.guild.id,
        creatorDiscordId: interaction.user.id,
        matchFormat: FORMAT_API[matchFormat] as any,
      });

      const lobbyId = lobby.id;
      const webUrl = `${process.env.WEB_URL ?? 'http://localhost:3000'}/dashboard/match/${lobbyId}`;
      const gif = this.getGifAttachment();
      const files = gif ? [gif] : [];
      const embed = buildMatchEmbed([], [], FORMAT_NAMES[matchFormat], 'Online', 'Aguardando jogadores... 0/10', webUrl, null, false, !!gif);
      const buttons = buildOnlineLobbyButtons(lobbyId, false, false, matchFormat);

      const lobbyMsg = await channels.text.send({ embeds: [embed], components: buttons, files });

      // Subscribe to SSE events directly via RxJS subject
      this.subscribeToLobbyEvents(lobbyId, lobbyMsg, matchFormat, channels);

      const msg = await interaction.followUp({
        content: `✅ Partida criada! Veja em ${channels.text}\n🌐 Ao vivo: ${webUrl}`,
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

  private subscribeToLobbyEvents(lobbyId: number, message: any, matchFormat: number, channels: any) {
    const subject = this.leagueMatchService.getOrCreateSubject(lobbyId);
    const discordUsers: Record<string, any> = {};
    let finished = false;

    const subscription = subject.subscribe({
      next: async (event: any) => {
        if (finished) return;
        const { type, payload } = event;

        if (['player_joined', 'player_left', 'teams_drawn', 'match_started', 'match_finished', 'state'].includes(type)) {
          await this.updateOnlineLobbyEmbed(message, payload, matchFormat);
        }

        if (type === 'match_expired') {
          finished = true;
          subscription.unsubscribe();
          setTimeout(() => message.delete().catch(() => {}), 5000);
          return;
        }

        if (type === 'match_finished' || payload?.status === 'FINISHED') {
          finished = true;
          subscription.unsubscribe();
        }
      },
      complete: () => { subscription.unsubscribe(); },
    });
  }

  private async updateOnlineLobbyEmbed(message: any, lobby: any, matchFormat: number) {
    const status = lobby?.status ?? 'WAITING';
    const players = lobby?.queuePlayers ?? lobby?.players ?? [];
    const teams = lobby?.Teams ?? [];
    const blueId = lobby?.teamBlueId;
    const redId = lobby?.teamRedId;

    let blueTeam: any[] = [];
    let redTeam: any[] = [];
    for (const t of teams) {
      if (t.id === blueId) blueTeam = t.players ?? [];
      else if (t.id === redId) redTeam = t.players ?? [];
    }

    const showDetails = blueTeam.length > 0 || redTeam.length > 0;
    const blueDisplay = showDetails ? blueTeam : players.slice(0, 5);
    const redDisplay = showDetails ? redTeam : players.slice(5, 10);

    let winner: 'BLUE' | 'RED' | null = null;
    if (status === 'FINISHED') {
      winner = lobby.winnerId === blueId ? 'BLUE' : 'RED';
    }

    const footerMap: Record<string, string> = {
      WAITING: `Aguardando jogadores... ${players.length}/10`,
      STARTED: 'Partida em andamento! 🎮',
      FINISHED: 'Partida finalizada! 🏁',
      EXPIRED: 'Partida expirada.',
    };

    const started = status === 'STARTED';
    const finished = status === 'FINISHED' || status === 'EXPIRED';
    const webUrl = (!winner && !finished)
      ? `${process.env.WEB_URL ?? 'http://localhost:3000'}/dashboard/match/${lobby.id}`
      : undefined;
    const hasGif = message.attachments?.some((a: any) => a.name === 'timbas.gif' || a.name === 'timbasQueueGif.gif') ?? false;
    const embed = buildMatchEmbed(blueDisplay, redDisplay, FORMAT_NAMES[matchFormat], 'Online', footerMap[status] ?? '', webUrl, winner, showDetails, hasGif);
    const buttons = buildOnlineLobbyButtons(lobby.id, started, finished, matchFormat);

    try {
      await message.edit({ embeds: [embed], components: buttons });
    } catch {}
  }

  private async createOfflineMatch(interaction: any, matchFormat: number, channels: any, debug: boolean) {
    let initialPlayers: string[] = [];

    if (debug) {
      initialPlayers = [
        '919276824578646068', '352240724693090305', '373887997826957312',
        '1089165750993948774', '209825857815052288', '343492133644140544',
        '191630723935895553', '214397364163706880', '430165932963266561',
        '635277051439611914',
      ];
    }

    const key = this.matchStateService.create({
      creatorId: interaction.user.id,
      matchFormatValue: matchFormat,
      matchFormatName: FORMAT_NAMES[matchFormat],
      onlineModeValue: 0,
      onlineModeName: 'Offline',
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
    const embed = buildMatchEmbed([], [], FORMAT_NAMES[matchFormat], 'Offline', 'Aguardando jogadores...', undefined, null, false, !!gif);
    const buttons = buildOfflineMatchButtons(key, false, matchFormat, initialPlayers.length, false);

    await channels.text.send({ embeds: [embed], components: buttons, files });

    const msg = await interaction.followUp({
      content: `Partida criada com sucesso! Veja em ${channels.text}`,
      flags: MessageFlags.Ephemeral,
      fetchReply: true,
    });
    setTimeout(() => msg.delete().catch(() => {}), 5000);
  }
}
