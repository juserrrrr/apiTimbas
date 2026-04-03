import { Injectable, Logger } from '@nestjs/common';
import { Button, ComponentParam, Context, ButtonContext } from 'necord';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  GuildMember,
  VoiceChannel,
} from 'discord.js';
import { MatchStateService } from '../services/match-state.service';
import { ChannelManagerService } from '../services/channel-manager.service';
import { LeagueMatchService } from '../../customLeagueMath/leagueMatch.service';
import { UserService } from '../../user/user.service';
import { buildOfflineMatchButtons } from '../helpers/match-buttons.helper';
import { buildMatchEmbed } from '../helpers/embed.helper';
import { drawTeams, drawTeamsWithPositions } from '../helpers/team.helper';
import { randomBytes } from 'crypto';

const FORMAT_NAMES: Record<number, string> = { 0: 'Aleatório', 1: 'Livre', 3: 'Aleatório Completo' };

function genRiotMatchId(): string {
  return 'TB_' + randomBytes(5).toString('hex').toUpperCase();
}

@Injectable()
export class OfflineMatchInteraction {
  private readonly logger = new Logger(OfflineMatchInteraction.name);

  constructor(
    private readonly matchStateService: MatchStateService,
    private readonly channelManager: ChannelManagerService,
    private readonly leagueMatchService: LeagueMatchService,
    private readonly userService: UserService,
  ) {}

  private async refreshMessage(interaction: any, key: string) {
    const state = this.matchStateService.get(key);
    if (!state) return;

    const { playersPerTeam = 5 } = state;
    const half = playersPerTeam;
    const maxPlayers = playersPerTeam * 2;

    const buttons = buildOfflineMatchButtons(key, state.started, state.matchFormatValue, state.confirmedPlayerIds.length, state.finished, playersPerTeam);
    const blueDisplay = state.blueTeam.length ? state.blueTeam : state.confirmedPlayerIds.slice(0, half).map((id) => ({ userId: id }));
    const redDisplay = state.redTeam.length ? state.redTeam : state.confirmedPlayerIds.slice(half, maxPlayers).map((id) => ({ userId: id }));

    const toEmbedPlayer = (e: any, idx: number) => {
      const member = interaction.guild.members.cache.get(e.userId ?? e);
      const fallbackName = state.debug ? `TestPlayer${idx + 1}` : (e.userId ?? '?');
      return { name: member?.displayName ?? fallbackName, position: e.position };
    };

    const hasGif = interaction.message.attachments?.some((a: any) => a.name === 'timbas.gif' || a.name === 'timbasQueueGif.gif') ?? false;
    const footerText = state.started
      ? 'Partida em andamento!'
      : state.confirmedPlayerIds.length >= maxPlayers
        ? 'Pronto para começar!'
        : `Aguardando jogadores... ${state.confirmedPlayerIds.length}/${maxPlayers}`;

    const embed = buildMatchEmbed(
      blueDisplay.map((e, i) => toEmbedPlayer(e, i)),
      redDisplay.map((e, i) => toEmbedPlayer(e, i + half)),
      state.matchFormatName,
      state.onlineModeName,
      footerText,
      undefined,
      null,
      state.showDetails,
      hasGif,
      playersPerTeam,
    );
    await interaction.message.edit({ embeds: [embed], components: buttons }).catch(() => {});
  }

  @Button('cm/join/:key')
  async onJoin(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const state = this.matchStateService.get(key);
    if (!state || state.started || state.finished) {
      await interaction.followUp({ content: '❌ Partida não encontrada ou já encerrada.', flags: MessageFlags.Ephemeral });
      return;
    }

    const member = interaction.member as GuildMember;
    if (!member.voice.channel) {
      const msg = await interaction.followUp({ content: '❌ Você precisa estar em um canal de voz.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const maxPlayers = (state.playersPerTeam ?? 5) * 2;

    if (state.confirmedPlayerIds.includes(interaction.user.id)) {
      const msg = await interaction.followUp({ content: '❌ Você já está na lista.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    if (state.confirmedPlayerIds.length >= maxPlayers) {
      const msg = await interaction.followUp({ content: '❌ A partida já está cheia.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const originalChannels = { ...state.originalChannels, [interaction.user.id]: member.voice.channel.id };
    const confirmedPlayerIds = [...state.confirmedPlayerIds, interaction.user.id];
    this.matchStateService.update(key, { confirmedPlayerIds, originalChannels });

    const waitingChannel = interaction.guild.channels.cache.get(state.waitingChannelId) as VoiceChannel;
    await this.channelManager.moveToChannel(member, waitingChannel);

    await this.refreshMessage(interaction, key);
    const msg = await interaction.followUp({ content: '✅ Você entrou na partida!', flags: MessageFlags.Ephemeral });
    setTimeout(() => msg.delete().catch(() => {}), 3000);
  }

  @Button('cm/leave/:key')
  async onLeave(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const state = this.matchStateService.get(key);
    if (!state || state.started) {
      await interaction.followUp({ content: '❌ Não é possível sair agora.', flags: MessageFlags.Ephemeral });
      return;
    }

    const userId = interaction.user.id;
    if (!state.confirmedPlayerIds.includes(userId)) {
      const msg = await interaction.followUp({ content: '❌ Você não está na lista.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const member = interaction.member as GuildMember;
    const originalChannelId = state.originalChannels[userId];
    if (originalChannelId && member.voice.channel) {
      const originalChannel = interaction.guild.channels.cache.get(originalChannelId) as VoiceChannel;
      await this.channelManager.moveToChannel(member, originalChannel);
    }

    const confirmedPlayerIds = state.confirmedPlayerIds.filter((id) => id !== userId);
    const originalChannels = { ...state.originalChannels };
    delete originalChannels[userId];
    this.matchStateService.update(key, { confirmedPlayerIds, originalChannels });

    await this.refreshMessage(interaction, key);
    const msg = await interaction.followUp({ content: '🚪 Você saiu da lista.', flags: MessageFlags.Ephemeral });
    setTimeout(() => msg.delete().catch(() => {}), 5000);
  }

  @Button('cm/draw/:key')
  async onDraw(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const state = this.matchStateService.get(key);
    if (!state || state.started) return;

    if (interaction.user.id !== state.creatorId) {
      const msg = await interaction.followUp({ content: '❌ Apenas o criador pode sortear.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const playersPerTeam = state.playersPerTeam ?? 5;
    const players = state.confirmedPlayerIds.map((id) => interaction.guild.members.cache.get(id) ?? id);
    let blueTeam: any[], redTeam: any[], showDetails: boolean;

    if (state.matchFormatValue === 3 && playersPerTeam === 5) {
      const [blue, red] = drawTeamsWithPositions(players);
      blueTeam = blue.map((e) => ({ userId: (e.user as any)?.id ?? e.user, position: e.position }));
      redTeam = red.map((e) => ({ userId: (e.user as any)?.id ?? e.user, position: e.position }));
      showDetails = true;
    } else {
      const [blue, red] = drawTeams(players);
      blueTeam = blue.map((u: any) => ({ userId: u?.id ?? u }));
      redTeam = red.map((u: any) => ({ userId: u?.id ?? u }));
      showDetails = false;
    }

    this.matchStateService.update(key, { blueTeam, redTeam, showDetails });
    await this.refreshMessage(interaction, key);

    const text = state.matchFormatValue === 3 && playersPerTeam === 5 ? 'Times e posições sorteados!' : 'Times sorteados!';
    const msg = await interaction.followUp({ content: `🎲 ${text}`, flags: MessageFlags.Ephemeral });
    setTimeout(() => msg.delete().catch(() => {}), 5000);
  }

  @Button('cm/start/:key')
  async onStart(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const state = this.matchStateService.get(key);
    if (!state || state.started) return;

    if (interaction.user.id !== state.creatorId) {
      const msg = await interaction.followUp({ content: '❌ Apenas o criador pode iniciar.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const playersPerTeam = state.playersPerTeam ?? 5;
    const maxPlayers = playersPerTeam * 2;

    if (state.confirmedPlayerIds.length < maxPlayers) {
      const msg = await interaction.followUp({ content: `❌ É necessário ter ${maxPlayers} jogadores para iniciar.`, flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    if ((state.matchFormatValue === 0 || state.matchFormatValue === 3) && !state.blueTeam.length) {
      const msg = await interaction.followUp({ content: '❌ Sorteie os times primeiro.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    let { blueTeam, redTeam } = state;
    if (state.matchFormatValue === 1) {
      blueTeam = state.confirmedPlayerIds.slice(0, playersPerTeam).map((id) => ({ userId: id }));
      redTeam = state.confirmedPlayerIds.slice(playersPerTeam, maxPlayers).map((id) => ({ userId: id }));
    }

    // Offline: no API call — just move players and update state
    this.matchStateService.update(key, { started: true, blueTeam, redTeam });

    if (!state.debug) {
      const blueChannel = interaction.guild.channels.cache.get(state.blueChannelId) as VoiceChannel;
      const redChannel = interaction.guild.channels.cache.get(state.redChannelId) as VoiceChannel;
      for (const e of blueTeam) {
        const m = interaction.guild.members.cache.get(e.userId);
        if (m) await this.channelManager.moveToChannel(m, blueChannel);
      }
      for (const e of redTeam) {
        const m = interaction.guild.members.cache.get(e.userId);
        if (m) await this.channelManager.moveToChannel(m, redChannel);
      }
    }

    await this.refreshMessage(interaction, key);
    const msg = await interaction.followUp({ content: '▶ Partida iniciada!', flags: MessageFlags.Ephemeral });
    setTimeout(() => msg.delete().catch(() => {}), 3000);
  }

  @Button('cm/finish/:key')
  async onFinish(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const state = this.matchStateService.get(key);
    if (!state || !state.started || state.finished) return;

    if (interaction.user.id !== state.creatorId) {
      const msg = await interaction.followUp({ content: '❌ Apenas o criador pode finalizar.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    // Offline: just restore channels and finish
    if (!state.debug) {
      for (const [userId, channelId] of Object.entries(state.originalChannels)) {
        const member = interaction.guild.members.cache.get(userId);
        const channel = interaction.guild.channels.cache.get(channelId) as VoiceChannel;
        if (member) await this.channelManager.moveToChannel(member, channel);
      }
    }
    this.matchStateService.update(key, { finished: true });
    await this.refreshMessage(interaction, key);

    const msg = await interaction.followUp({ content: '🏁 Partida finalizada!', flags: MessageFlags.Ephemeral });
    setTimeout(() => msg.delete().catch(() => {}), 3000);
  }

  @Button('cm/rejoin/:key')
  async onRejoin(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const state = this.matchStateService.get(key);
    if (!state || !state.started) return;

    const member = interaction.member as GuildMember;
    if (!member.voice.channel) {
      const msg = await interaction.followUp({ content: '❌ Você precisa estar em um canal de voz.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const isBlue = state.blueTeam.some((e) => e.userId === interaction.user.id);
    const isRed = state.redTeam.some((e) => e.userId === interaction.user.id);

    if (!isBlue && !isRed) {
      const msg = await interaction.followUp({ content: '❌ Você não faz parte desta partida.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const channelId = isBlue ? state.blueChannelId : state.redChannelId;
    const channel = interaction.guild.channels.cache.get(channelId) as VoiceChannel;
    await this.channelManager.moveToChannel(member, channel);

    const teamName = isBlue ? 'Azul' : 'Vermelho';
    const msg = await interaction.followUp({ content: `🔄 Você foi movido para o canal do Time ${teamName}.`, flags: MessageFlags.Ephemeral });
    setTimeout(() => msg.delete().catch(() => {}), 5000);
  }
}
