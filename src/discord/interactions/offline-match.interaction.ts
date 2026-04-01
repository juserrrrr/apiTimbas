import { Injectable, Logger } from '@nestjs/common';
import { Button, ComponentParam, Context, ButtonContext } from 'necord';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  GuildMember,
  VoiceChannel,
} from 'discord.js';
import { MatchStateService } from '../services/match-state.service';
import { ChannelManagerService } from '../services/channel-manager.service';
import { LeagueMatchService } from '../../customLeagueMath/leagueMatch.service';
import { UserService } from '../../user/user.service';
import { buildOfflineMatchButtons, buildMatchEmbed } from '../commands/criar-personalizada.command';
import { drawTeams, drawTeamsWithPositions, extractUserFromTeamEntry } from '../helpers/team.helper';
import { generateLeagueEmbedText } from '../helpers/embed.helper';
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
    const buttons = buildOfflineMatchButtons(key, state.started, state.matchFormatValue, state.confirmedPlayerIds.length, state.finished);
    const blueDisplay = state.blueTeam.length ? state.blueTeam : state.confirmedPlayerIds.slice(0, 5).map((id) => ({ userId: id }));
    const redDisplay = state.redTeam.length ? state.redTeam : state.confirmedPlayerIds.slice(5).map((id) => ({ userId: id }));
    const toEmbedPlayer = (e: any) => {
      const member = interaction.guild.members.cache.get(e.userId ?? e);
      return { name: member?.displayName ?? e.userId ?? '?', position: e.position };
    };
    const embed = buildMatchEmbed(
      blueDisplay.map(toEmbedPlayer),
      redDisplay.map(toEmbedPlayer),
      state.matchFormatName,
      state.onlineModeName,
      state.started ? 'Partida em andamento!' : state.confirmedPlayerIds.length >= 10 ? 'Pronto para começar!' : 'Aguardando jogadores...',
    );
    await interaction.message.edit({ embeds: [embed], components: buttons }).catch(() => {});
  }

  @Button('cm/join/:key')
  async onJoin(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferReply({ ephemeral: true });
    const state = this.matchStateService.get(key);
    if (!state || state.started || state.finished) {
      await interaction.followUp({ content: '❌ Partida não encontrada ou já encerrada.', ephemeral: true });
      return;
    }

    const member = interaction.member as GuildMember;
    if (!member.voice.channel) {
      const msg = await interaction.followUp({ content: '❌ Você precisa estar em um canal de voz.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    if (state.confirmedPlayerIds.includes(interaction.user.id)) {
      const msg = await interaction.followUp({ content: '❌ Você já está na lista.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    if (state.confirmedPlayerIds.length >= 10) {
      const msg = await interaction.followUp({ content: '❌ A partida já está cheia.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    // Online mode: check/create account
    if (state.onlineModeValue === 1) {
      try {
        await this.userService.findOneByDiscordId(interaction.user.id);
      } catch {
        try {
          await this.userService.createPlayer({ discordId: interaction.user.id, name: interaction.user.username } as any);
        } catch {
          const msg = await interaction.followUp({ content: '❌ Erro ao criar conta Timbas.', ephemeral: true });
          setTimeout(() => msg.delete().catch(() => {}), 5000);
          return;
        }
      }
    }

    // Store original channel
    const originalChannels = { ...state.originalChannels, [interaction.user.id]: member.voice.channel.id };
    const confirmedPlayerIds = [...state.confirmedPlayerIds, interaction.user.id];
    this.matchStateService.update(key, { confirmedPlayerIds, originalChannels });

    // Move to waiting channel
    const waitingChannel = interaction.guild.channels.cache.get(state.waitingChannelId) as VoiceChannel;
    await this.channelManager.moveToChannel(member, waitingChannel);

    await this.refreshMessage(interaction, key);
    const msg = await interaction.followUp({ content: '✅ Você entrou na partida!', ephemeral: true });
    setTimeout(() => msg.delete().catch(() => {}), 3000);
  }

  @Button('cm/leave/:key')
  async onLeave(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferReply({ ephemeral: true });
    const state = this.matchStateService.get(key);
    if (!state || state.started) {
      await interaction.followUp({ content: '❌ Não é possível sair agora.', ephemeral: true });
      return;
    }

    const userId = interaction.user.id;
    if (!state.confirmedPlayerIds.includes(userId)) {
      const msg = await interaction.followUp({ content: '❌ Você não está na lista.', ephemeral: true });
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
    const msg = await interaction.followUp({ content: '🚪 Você saiu da lista.', ephemeral: true });
    setTimeout(() => msg.delete().catch(() => {}), 5000);
  }

  @Button('cm/draw/:key')
  async onDraw(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferReply({ ephemeral: true });
    const state = this.matchStateService.get(key);
    if (!state || state.started) return;

    if (interaction.user.id !== state.creatorId) {
      const msg = await interaction.followUp({ content: '❌ Apenas o criador pode sortear.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const players = state.confirmedPlayerIds.map((id) => interaction.guild.members.cache.get(id) ?? id);
    let blueTeam: any[], redTeam: any[], showDetails: boolean;

    if (state.matchFormatValue === 3) {
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

    const text = state.matchFormatValue === 3 ? 'Times e posições sorteados!' : 'Times sorteados!';
    const msg = await interaction.followUp({ content: `🎲 ${text}`, ephemeral: true });
    setTimeout(() => msg.delete().catch(() => {}), 5000);
  }

  @Button('cm/start/:key')
  async onStart(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferReply({ ephemeral: true });
    const state = this.matchStateService.get(key);
    if (!state || state.started) return;

    if (interaction.user.id !== state.creatorId) {
      const msg = await interaction.followUp({ content: '❌ Apenas o criador pode iniciar.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    if (state.confirmedPlayerIds.length < 10) {
      const msg = await interaction.followUp({ content: '❌ É necessário ter 10 jogadores para iniciar.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    if ((state.matchFormatValue === 0 || state.matchFormatValue === 3) && !state.blueTeam.length) {
      const msg = await interaction.followUp({ content: '❌ Sorteie os times primeiro.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    let { blueTeam, redTeam } = state;
    if (state.matchFormatValue === 1) {
      const half = Math.floor(state.confirmedPlayerIds.length / 2);
      blueTeam = state.confirmedPlayerIds.slice(0, half).map((id) => ({ userId: id }));
      redTeam = state.confirmedPlayerIds.slice(half).map((id) => ({ userId: id }));
    }

    // Create match in API if online
    let matchId: number | undefined, blueTeamId: number | undefined, redTeamId: number | undefined;
    if (state.onlineModeValue === 1) {
      try {
        const riotMatchId = genRiotMatchId();
        const match = await this.leagueMatchService.create({
          ServerDiscordId: state.guildId,
          riotMatchId,
          matchType: state.matchFormatValue,
          teamBlue: { players: blueTeam.map((e) => ({ discordId: e.userId, position: e.position })) },
          teamRed: { players: redTeam.map((e) => ({ discordId: e.userId, position: e.position })) },
        } as any);
        matchId = match.id;
        blueTeamId = match.teamBlueId;
        redTeamId = match.teamRedId;
      } catch (e) {
        this.logger.error(`Failed to create match in API: ${e}`);
        const msg = await interaction.followUp({ content: '❌ Erro ao criar partida na API.', ephemeral: true });
        setTimeout(() => msg.delete().catch(() => {}), 5000);
        return;
      }
    }

    this.matchStateService.update(key, { started: true, blueTeam, redTeam, matchId, blueTeamId, redTeamId });

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
    const msg = await interaction.followUp({ content: '▶ Partida iniciada!', ephemeral: true });
    setTimeout(() => msg.delete().catch(() => {}), 3000);
  }

  @Button('cm/finish/:key')
  async onFinish(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferReply({ ephemeral: true });
    const state = this.matchStateService.get(key);
    if (!state || !state.started || state.finished) return;

    if (interaction.user.id !== state.creatorId) {
      const msg = await interaction.followUp({ content: '❌ Apenas o criador pode finalizar.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    if (state.onlineModeValue === 0) {
      // Offline: just finish, restore channels
      if (!state.debug) {
        for (const [userId, channelId] of Object.entries(state.originalChannels)) {
          const member = interaction.guild.members.cache.get(userId);
          const channel = interaction.guild.channels.cache.get(channelId) as VoiceChannel;
          if (member) await this.channelManager.moveToChannel(member, channel);
        }
      }
      this.matchStateService.update(key, { finished: true });
      await this.refreshMessage(interaction, key);
      return;
    }

    if (state.finishing) {
      const msg = await interaction.followUp({ content: '❌ Seleção de vencedor já em andamento.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    if (!state.matchId || !state.blueTeamId || !state.redTeamId) {
      const msg = await interaction.followUp({ content: '❌ IDs da partida não encontrados.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    this.matchStateService.update(key, { finishing: true });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`cm/winner/${key}`)
      .setPlaceholder('Selecione o time vencedor...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Time Azul').setValue(String(state.blueTeamId)).setEmoji('🔵'),
        new StringSelectMenuOptionBuilder().setLabel('Time Vermelho').setValue(String(state.redTeamId)).setEmoji('🔴'),
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const msg = await interaction.followUp({ content: '🏆 Quem venceu a partida?', components: [row], ephemeral: true, fetchReply: true });
    setTimeout(() => {
      if (!this.matchStateService.get(key)?.finished) {
        this.matchStateService.update(key, { finishing: false });
        msg.delete().catch(() => {});
      }
    }, 180_000);
  }

  @Button('cm/rejoin/:key')
  async onRejoin(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferReply({ ephemeral: true });
    const state = this.matchStateService.get(key);
    if (!state || !state.started) return;

    const member = interaction.member as GuildMember;
    if (!member.voice.channel) {
      const msg = await interaction.followUp({ content: '❌ Você precisa estar em um canal de voz.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const isBlue = state.blueTeam.some((e) => e.userId === interaction.user.id);
    const isRed = state.redTeam.some((e) => e.userId === interaction.user.id);

    if (!isBlue && !isRed) {
      const msg = await interaction.followUp({ content: '❌ Você não faz parte desta partida.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const channelId = isBlue ? state.blueChannelId : state.redChannelId;
    const channel = interaction.guild.channels.cache.get(channelId) as VoiceChannel;
    await this.channelManager.moveToChannel(member, channel);

    const teamName = isBlue ? 'Azul' : 'Vermelho';
    const msg = await interaction.followUp({ content: `🔄 Você foi movido para o canal do Time ${teamName}.`, ephemeral: true });
    setTimeout(() => msg.delete().catch(() => {}), 5000);
  }
}
