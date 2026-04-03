import { Injectable, Logger } from '@nestjs/common';
import { Button, ComponentParam, Context, ButtonContext, Modal, ModalContext, ModalParam } from 'necord';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
} from 'discord.js';
import { EventStateService, EventEntry } from '../services/event-state.service';
import { EventoCommand } from '../commands/evento.command';
import { LeagueMatchService } from '../../customLeagueMath/leagueMatch.service';
import { ChannelManagerService } from '../services/channel-manager.service';
import { MatchStateService } from '../services/match-state.service';
import { buildMatchEmbed } from '../helpers/embed.helper';
import { buildOfflineMatchButtons, buildOnlineLobbyButtons } from '../helpers/match-buttons.helper';

const FORMAT_NAMES: Record<number, string> = { 0: 'Aleatório', 1: 'Livre', 3: 'Aleatório Completo' };
const FORMAT_API: Record<number, string> = { 0: 'ALEATORIO', 1: 'LIVRE', 3: 'ALEATORIO_COMPLETO' };

@Injectable()
export class EventInteraction {
  private readonly logger = new Logger(EventInteraction.name);

  constructor(
    private readonly eventStateService: EventStateService,
    private readonly eventoCommand: EventoCommand,
    private readonly leagueMatchService: LeagueMatchService,
    private readonly channelManager: ChannelManagerService,
    private readonly matchStateService: MatchStateService,
  ) {}

  @Modal('event_create/:channelId')
  async onEventModal(@Context() [interaction]: ModalContext, @ModalParam('channelId') channelId: string) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const titulo = interaction.fields.getTextInputValue('titulo').trim();
    const descricao = interaction.fields.getTextInputValue('descricao')?.trim() || null;
    const horario = interaction.fields.getTextInputValue('horario')?.trim() || null;

    const channel = interaction.guild!.channels.cache.get(channelId) as TextChannel;
    if (!channel) {
      await interaction.followUp({ content: '❌ Canal não encontrado.', flags: MessageFlags.Ephemeral });
      return;
    }

    const embed = this.eventoCommand.buildEventEmbed(interaction.member ?? interaction.user, titulo, descricao, horario, [], []);
    // Send with placeholder customId — we'll update after we know the messageId
    const tempRow = this.eventoCommand.buildEventButtons('pending');
    const msg = await channel.send({ embeds: [embed], components: [tempRow] });

    const entry: EventEntry = {
      messageId: msg.id,
      creatorId: interaction.user.id,
      titulo,
      descricao,
      horario,
      goingIds: [],
      notGoingIds: [],
      createdAt: Date.now(),
    };
    this.eventStateService.upsert(entry);

    // Update buttons with real messageId
    const realRow = this.eventoCommand.buildEventButtons(msg.id);
    await msg.edit({ components: [realRow] });

    const reply = await interaction.followUp({ content: `Evento criado em ${channel}!`, flags: MessageFlags.Ephemeral });
    setTimeout(() => reply.delete().catch(() => {}), 5000);
  }

  @Button('event/vou/:messageId')
  async onVou(@Context() [interaction]: ButtonContext, @ComponentParam('messageId') messageId: string) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const entry = this.eventStateService.get(messageId);
    if (!entry) return;

    const userId = interaction.user.id;
    let goingIds = [...entry.goingIds];
    let notGoingIds = entry.notGoingIds.filter((id) => id !== userId);

    if (goingIds.includes(userId)) {
      const msg = await interaction.followUp({ content: 'Você já confirmou presença.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 4000);
      return;
    }

    goingIds.push(userId);
    this.eventStateService.upsert({ ...entry, goingIds, notGoingIds });
    await this.updateEventEmbed(interaction, messageId, { ...entry, goingIds, notGoingIds });

    const msg = await interaction.followUp({ content: '✅ Presença confirmada!', flags: MessageFlags.Ephemeral });
    setTimeout(() => msg.delete().catch(() => {}), 4000);
  }

  @Button('event/nao_vou/:messageId')
  async onNaoVou(@Context() [interaction]: ButtonContext, @ComponentParam('messageId') messageId: string) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const entry = this.eventStateService.get(messageId);
    if (!entry) return;

    const userId = interaction.user.id;
    let notGoingIds = [...entry.notGoingIds];
    let goingIds = entry.goingIds.filter((id) => id !== userId);

    if (notGoingIds.includes(userId)) {
      const msg = await interaction.followUp({ content: 'Você já marcou que não vai.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 4000);
      return;
    }

    notGoingIds.push(userId);
    this.eventStateService.upsert({ ...entry, goingIds, notGoingIds });
    await this.updateEventEmbed(interaction, messageId, { ...entry, goingIds, notGoingIds });

    const msg = await interaction.followUp({ content: '❌ Marcado como não vai.', flags: MessageFlags.Ephemeral });
    setTimeout(() => msg.delete().catch(() => {}), 4000);
  }

  @Button('event/criar/:messageId')
  async onCriarPartida(@Context() [interaction]: ButtonContext, @ComponentParam('messageId') messageId: string) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const entry = this.eventStateService.get(messageId);
    if (!entry) return;

    if (interaction.user.id !== entry.creatorId) {
      const msg = await interaction.followUp({ content: 'Apenas o criador do evento pode iniciar a partida.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const select1 = new StringSelectMenuBuilder()
      .setCustomId(`event_format/${messageId}`)
      .setPlaceholder('Formato da partida...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Aleatório').setValue('0').setEmoji('🎲'),
        new StringSelectMenuOptionBuilder().setLabel('Livre').setValue('1').setEmoji('✋'),
        new StringSelectMenuOptionBuilder().setLabel('Aleatório Completo').setValue('3').setEmoji('🔀'),
      );
    const select2 = new StringSelectMenuBuilder()
      .setCustomId(`event_mode/${messageId}`)
      .setPlaceholder('Modo da partida...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Online').setValue('1').setDescription('Registra estatísticas').setEmoji('📊'),
        new StringSelectMenuOptionBuilder().setLabel('Offline').setValue('0').setDescription('Sem registro').setEmoji('🎮'),
      );

    const msg = await interaction.followUp({
      content: 'Escolha o formato e o modo da partida:',
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select1),
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select2),
      ],
      flags: MessageFlags.Ephemeral,
      fetchReply: true,
    });
    setTimeout(() => msg.delete().catch(() => {}), 60_000);
  }

  private async updateEventEmbed(interaction: any, messageId: string, entry: EventEntry) {
    const guild = interaction.guild!;
    const getNames = (ids: string[]) =>
      ids.map((id) => guild.members.cache.get(id)?.displayName ?? id);

    const embed = this.eventoCommand.buildEventEmbed(
      interaction.member ?? interaction.user,
      entry.titulo,
      entry.descricao,
      entry.horario,
      getNames(entry.goingIds),
      getNames(entry.notGoingIds),
    );

    try {
      await interaction.message!.edit({ embeds: [embed] });
    } catch {}
  }
}
