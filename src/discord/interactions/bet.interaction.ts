import { Injectable, Logger } from '@nestjs/common';
import { Button, ButtonContext, ComponentParam, Context, Modal, ModalContext, ModalParam } from 'necord';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { BetStatus, MatchStatus, Side } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeagueMatchService } from '../../customLeagueMath/leagueMatch.service';
import { WalletService } from '../../engagement/wallet.service';

@Injectable()
export class BetInteraction {
  private readonly logger = new Logger(BetInteraction.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leagueMatchService: LeagueMatchService,
    private readonly walletService: WalletService,
  ) {}

  private isParticipant(match: any, discordId: string): boolean {
    const inTeams = (match.Teams ?? []).some((t: any) => (t.players ?? []).some((p: any) => p.user?.discordId === discordId));
    const inQueue = (match.queuePlayers ?? []).some((p: any) => p.user?.discordId === discordId);
    return inTeams || inQueue;
  }

  @Button('bet/open/:matchId')
  async onOpen(@Context() [interaction]: ButtonContext, @ComponentParam('matchId') matchId: string) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const match = await this.leagueMatchService.findOne(parseInt(matchId));
      if (match.status !== MatchStatus.STARTED) {
        throw new Error('As apostas só ficam abertas enquanto a partida está em andamento.');
      }
      if (this.isParticipant(match, interaction.user.id)) {
        throw new Error('Quem está jogando a partida não pode apostar. 👀');
      }
      const existing = await this.prisma.bet.findUnique({
        where: { matchId_discordId: { matchId: match.id, discordId: interaction.user.id } },
      });
      if (existing) {
        throw new Error(`Você já apostou ${existing.amount} fichas no time ${existing.side === 'BLUE' ? 'Azul 🔵' : 'Vermelho 🔴'}.`);
      }

      const balance = await this.walletService.getBalance(interaction.guild!.id, interaction.user.id);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`bet/side/${matchId}/BLUE`).setLabel('Time Azul').setStyle(ButtonStyle.Primary).setEmoji('🔵'),
        new ButtonBuilder().setCustomId(`bet/side/${matchId}/RED`).setLabel('Time Vermelho').setStyle(ButtonStyle.Danger).setEmoji('🔴'),
      );
      await interaction.editReply({
        content: `🎰 **Aposta na partida #${matchId}** — acertou, dobra; errou, perdeu.\n🪙 Seu saldo: **${balance}** fichas. Em qual time você aposta?`,
        components: [row],
      });
    } catch (e: any) {
      await interaction.editReply({ content: `❌ ${e?.message ?? 'Erro ao abrir aposta.'}` });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
    }
  }

  @Button('bet/side/:matchId/:side')
  async onSide(
    @Context() [interaction]: ButtonContext,
    @ComponentParam('matchId') matchId: string,
    @ComponentParam('side') side: string,
  ) {
    const sideLabel = side === 'BLUE' ? 'Azul 🔵' : 'Vermelho 🔴';
    const modal = new ModalBuilder()
      .setCustomId(`bet/place/${matchId}/${side}`)
      .setTitle(`Apostar no Time ${side === 'BLUE' ? 'Azul' : 'Vermelho'}`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('amount')
            .setLabel(`Quantas fichas no time ${sideLabel.replace(/ .*/, '')}?`)
            .setPlaceholder('Ex: 50')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(6)
            .setRequired(true),
        ),
      );
    await interaction.showModal(modal);
  }

  @Modal('bet/place/:matchId/:side')
  async onPlace(
    @Context() [interaction]: ModalContext,
    @ModalParam('matchId') matchIdRaw: string,
    @ModalParam('side') sideRaw: string,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const matchId = parseInt(matchIdRaw);
    const side = sideRaw === 'BLUE' ? Side.BLUE : Side.RED;
    const serverId = interaction.guild!.id;
    const discordId = interaction.user.id;

    try {
      const amount = parseInt(interaction.fields.getTextInputValue('amount').trim(), 10);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Valor inválido — digite um número inteiro de fichas.');
      }

      const match = await this.leagueMatchService.findOne(matchId);
      if (match.status !== MatchStatus.STARTED) {
        throw new Error('A partida não está mais aberta para apostas.');
      }
      if (this.isParticipant(match, discordId)) {
        throw new Error('Quem está jogando a partida não pode apostar. 👀');
      }

      // debita primeiro; se a criação falhar (aposta duplicada), devolve
      await this.walletService.debit(serverId, discordId, amount);
      try {
        await this.prisma.bet.create({
          data: { matchId, serverId, discordId, side, amount, status: BetStatus.PENDING },
        });
      } catch (e) {
        await this.walletService.credit(serverId, discordId, amount);
        throw new Error('Você já tem uma aposta nesta partida.');
      }

      const balance = await this.walletService.getBalance(serverId, discordId);
      await interaction.editReply({
        content: `✅ Aposta registrada: **${amount}** fichas no Time ${side === 'BLUE' ? 'Azul 🔵' : 'Vermelho 🔴'} (partida #${matchId}).\n🪙 Saldo restante: **${balance}** fichas. Boa sorte!`,
      });
    } catch (e: any) {
      await interaction.editReply({ content: `❌ ${e?.message ?? 'Erro ao registrar aposta.'}` });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
    }
  }
}
