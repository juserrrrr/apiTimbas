import { Injectable, Logger } from '@nestjs/common';
import { ComponentParam, Context, StringSelect, StringSelectContext } from 'necord';
import { GuildMember, MessageFlags, VoiceChannel } from 'discord.js';
import { MatchStateService } from '../services/match-state.service';
import { ChannelManagerService } from '../services/channel-manager.service';
import { LeagueMatchService } from '../../customLeagueMath/leagueMatch.service';
import { buildMatchEmbed } from '../commands/criar-personalizada.command';

const FORMAT_NAMES: Record<number, string> = { 0: 'Aleatório', 1: 'Livre', 3: 'Aleatório Completo' };

@Injectable()
export class OfflineMatchSelectInteraction {
  private readonly logger = new Logger(OfflineMatchSelectInteraction.name);

  constructor(
    private readonly matchStateService: MatchStateService,
    private readonly channelManager: ChannelManagerService,
    private readonly leagueMatchService: LeagueMatchService,
  ) {}

  @StringSelect('cm/winner/:key')
  async onWinnerSelect(@Context() [interaction]: StringSelectContext, @ComponentParam('key') key: string) {
    await interaction.deferUpdate();
    const state = this.matchStateService.get(key);
    if (!state || state.finished) return;

    if (interaction.user.id !== state.creatorId) {
      await interaction.followUp({ content: '❌ Apenas o criador pode selecionar o vencedor.', flags: MessageFlags.Ephemeral });
      return;
    }

    const winnerTeamId = parseInt(interaction.values[0], 10);
    const winnerSide = winnerTeamId === state.blueTeamId ? 'BLUE' : 'RED';
    const winnerLabel = winnerSide === 'BLUE' ? 'Azul' : 'Vermelho';

    try {
      await this.leagueMatchService.update(state.matchId!, { winnerId: winnerTeamId } as any);
    } catch (e) {
      this.logger.error(`Failed to update winner: ${e}`);
      await interaction.followUp({ content: '❌ Erro ao finalizar partida.', flags: MessageFlags.Ephemeral });
      this.matchStateService.update(key, { finishing: false });
      return;
    }

    this.matchStateService.update(key, { finished: true, finishing: false });

    if (!state.debug) {
      for (const [userId, channelId] of Object.entries(state.originalChannels)) {
        const member = interaction.guild!.members.cache.get(userId);
        const channel = interaction.guild!.channels.cache.get(channelId) as VoiceChannel;
        if (member) await this.channelManager.moveToChannel(member, channel);
      }
    }

    const toEmbedPlayer = (e: any) => {
      const member = interaction.guild!.members.cache.get(e.userId ?? e);
      return { name: member?.displayName ?? e.userId ?? '?', position: e.position };
    };

    const embed = buildMatchEmbed(
      state.blueTeam.map(toEmbedPlayer),
      state.redTeam.map(toEmbedPlayer),
      state.matchFormatName,
      state.onlineModeName,
      `Partida finalizada! Vencedor: Time ${winnerLabel}`,
      undefined,
      winnerSide,
      state.showDetails,
    );

    await interaction.message!.edit({ embeds: [embed], components: [] }).catch(() => {});
    await interaction.deleteReply().catch(() => {});
  }
}
