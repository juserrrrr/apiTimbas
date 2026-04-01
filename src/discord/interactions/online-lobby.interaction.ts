import { Injectable, Logger } from '@nestjs/common';
import { Button, ComponentParam, Context, ButtonContext, StringSelect, StringSelectContext } from 'necord';
import {
  ActionRowBuilder,
  GuildMember,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  VoiceChannel,
} from 'discord.js';
import { LeagueMatchService } from '../../customLeagueMath/leagueMatch.service';
import { UserService } from '../../user/user.service';
import { ChannelManagerService } from '../services/channel-manager.service';
import { buildOnlineLobbyButtons, buildMatchEmbed } from '../commands/criar-personalizada.command';

const FORMAT_NAMES: Record<string, string> = { ALEATORIO: 'Aleatório', LIVRE: 'Livre', ALEATORIO_COMPLETO: 'Aleatório Completo' };
const FORMAT_VALUES: Record<number, number> = {};

// Map lobby ID -> discord users cache
const lobbyUsers = new Map<string, Map<string, GuildMember>>();

@Injectable()
export class OnlineLobbyInteraction {
  private readonly logger = new Logger(OnlineLobbyInteraction.name);

  constructor(
    private readonly leagueMatchService: LeagueMatchService,
    private readonly userService: UserService,
    private readonly channelManager: ChannelManagerService,
  ) {}

  private getLobbyUsers(lobbyId: string): Map<string, GuildMember> {
    if (!lobbyUsers.has(lobbyId)) lobbyUsers.set(lobbyId, new Map());
    return lobbyUsers.get(lobbyId)!;
  }

  private async refreshLobbyEmbed(interaction: any, lobby: any) {
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
    if (status === 'FINISHED') winner = lobby.winnerId === blueId ? 'BLUE' : 'RED';

    const footerMap: Record<string, string> = {
      WAITING: `Aguardando jogadores... ${players.length}/10`,
      STARTED: 'Partida em andamento! 🎮',
      FINISHED: 'Partida finalizada! 🏁',
      EXPIRED: 'Partida expirada.',
    };

    const matchFormatValue = lobby?.matchFormat === 'LIVRE' ? 1 : 0;
    const started = status === 'STARTED';
    const finished = ['FINISHED', 'EXPIRED'].includes(status);
    const formatName = FORMAT_NAMES[lobby?.matchFormat] ?? 'Aleatório';
    const embed = buildMatchEmbed(blueDisplay, redDisplay, formatName, 'Online', footerMap[status] ?? '');
    const buttons = buildOnlineLobbyButtons(lobby.id, started, finished, matchFormatValue);

    try { await interaction.message.edit({ embeds: [embed], components: buttons }); } catch {}
  }

  @Button('ol/join/:lobbyId')
  async onJoin(@Context() [interaction]: ButtonContext, @ComponentParam('lobbyId') lobbyId: string) {
    await interaction.deferReply({ ephemeral: true });
    const member = interaction.member as GuildMember;

    if (!member.voice.channel) {
      const msg = await interaction.followUp({ content: '❌ Você precisa estar em um canal de voz.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    // Ensure account exists
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

    try {
      const lobby = await this.leagueMatchService.join(parseInt(lobbyId), {
        discordId: interaction.user.id,
      });

      // Cache the member for voice moves
      this.getLobbyUsers(lobbyId).set(interaction.user.id, member);

      // Get waiting channel from any voice channel named AGUARDANDO in guild
      const waitingChannel = interaction.guild!.channels.cache.find(
        (c) => c.name === '| 🕘 | AGUARDANDO',
      ) as VoiceChannel | undefined;
      if (waitingChannel) await this.channelManager.moveToChannel(member, waitingChannel);

      await this.refreshLobbyEmbed(interaction, lobby);
      const msg = await interaction.followUp({ content: '✅ Você entrou na partida!', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 3000);
    } catch (e: any) {
      const msg = await interaction.followUp({ content: `❌ ${e?.message ?? 'Erro ao entrar na partida.'}`, ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
    }
  }

  @Button('ol/leave/:lobbyId')
  async onLeave(@Context() [interaction]: ButtonContext, @ComponentParam('lobbyId') lobbyId: string) {
    await interaction.deferReply({ ephemeral: true });
    const member = interaction.member as GuildMember;

    try {
      const lobby = await this.leagueMatchService.leave(parseInt(lobbyId), interaction.user.id);
      this.getLobbyUsers(lobbyId).delete(interaction.user.id);
      await this.refreshLobbyEmbed(interaction, lobby);
      const msg = await interaction.followUp({ content: '🚪 Você saiu da partida.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 3000);
    } catch (e: any) {
      const msg = await interaction.followUp({ content: `❌ ${e?.message ?? 'Erro ao sair.'}`, ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
    }
  }

  @Button('ol/draw/:lobbyId')
  async onDraw(@Context() [interaction]: ButtonContext, @ComponentParam('lobbyId') lobbyId: string) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const lobby = await this.leagueMatchService.draw(parseInt(lobbyId), interaction.user.id);
      await this.refreshLobbyEmbed(interaction, lobby);
      const msg = await interaction.followUp({ content: '🎲 Times sorteados!', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 3000);
    } catch (e: any) {
      const msg = await interaction.followUp({ content: `❌ ${e?.message ?? 'Erro ao sortear.'}`, ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
    }
  }

  @Button('ol/start/:lobbyId')
  async onStart(@Context() [interaction]: ButtonContext, @ComponentParam('lobbyId') lobbyId: string) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const lobby = await this.leagueMatchService.start(parseInt(lobbyId), interaction.user.id);

      // Move players to team channels
      const blueChannel = interaction.guild!.channels.cache.find((c) => c.name === 'LADO [ |🔵| ]') as VoiceChannel | undefined;
      const redChannel = interaction.guild!.channels.cache.find((c) => c.name === 'LADO [ |🔴| ]') as VoiceChannel | undefined;

      if (blueChannel && redChannel) {
        const teams = lobby?.Teams ?? [];
        const blueId = lobby?.teamBlueId;
        const redId = lobby?.teamRedId;
        const blueTeam = teams.find((t: any) => t.id === blueId)?.players ?? [];
        const redTeam = teams.find((t: any) => t.id === redId)?.players ?? [];
        const users = this.getLobbyUsers(lobbyId);

        for (const p of blueTeam) {
          const discordId = (p as any)?.user?.discordId;
          const m = users.get(discordId) ?? interaction.guild!.members.cache.get(discordId);
          if (m) await this.channelManager.moveToChannel(m, blueChannel);
        }
        for (const p of redTeam) {
          const discordId = (p as any)?.user?.discordId;
          const m = users.get(discordId) ?? interaction.guild!.members.cache.get(discordId);
          if (m) await this.channelManager.moveToChannel(m, redChannel);
        }
      }

      await this.refreshLobbyEmbed(interaction, lobby);
      const msg = await interaction.followUp({ content: '▶ Partida iniciada!', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 3000);
    } catch (e: any) {
      const msg = await interaction.followUp({ content: `❌ ${e?.message ?? 'Erro ao iniciar.'}`, ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
    }
  }

  @Button('ol/finish/:lobbyId')
  async onFinish(@Context() [interaction]: ButtonContext, @ComponentParam('lobbyId') lobbyId: string) {
    await interaction.deferReply({ ephemeral: true });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`ol/winner/${lobbyId}`)
      .setPlaceholder('Selecione o time vencedor...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Time Azul').setValue('BLUE').setEmoji('🔵'),
        new StringSelectMenuOptionBuilder().setLabel('Time Vermelho').setValue('RED').setEmoji('🔴'),
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const msg = await interaction.followUp({ content: '🏆 Quem venceu a partida?', components: [row], ephemeral: true, fetchReply: true });
    setTimeout(() => msg.delete().catch(() => {}), 120_000);
  }

  @StringSelect('ol/winner/:lobbyId')
  async onWinnerSelect(@Context() [interaction]: StringSelectContext, @ComponentParam('lobbyId') lobbyId: string) {
    await interaction.deferUpdate();
    const winner = interaction.values[0] as 'BLUE' | 'RED';

    try {
      const lobby = await this.leagueMatchService.finish(parseInt(lobbyId), interaction.user.id, winner);

      // Restore original channels
      const waitingChannel = interaction.guild!.channels.cache.find((c) => c.name === '| 🕘 | AGUARDANDO') as VoiceChannel | undefined;
      const users = this.getLobbyUsers(lobbyId);
      for (const member of users.values()) {
        if (waitingChannel) await this.channelManager.moveToChannel(member, waitingChannel);
      }
      lobbyUsers.delete(lobbyId);

      await this.refreshLobbyEmbed(interaction, lobby);
      await interaction.deleteReply().catch(() => {});
    } catch (e: any) {
      await interaction.followUp({ content: `❌ ${e?.message ?? 'Erro ao finalizar.'}`, ephemeral: true });
    }
  }
}
