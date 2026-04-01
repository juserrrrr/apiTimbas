import { Injectable, Logger } from '@nestjs/common';
import { Context, SlashCommand, SlashCommandContext } from 'necord';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  GuildMember,
} from 'discord.js';
import { EventStateService, EventEntry } from '../services/event-state.service';

@Injectable()
export class EventoCommand {
  private readonly logger = new Logger(EventoCommand.name);

  constructor(private readonly eventStateService: EventStateService) {}

  @SlashCommand({ name: 'evento', description: 'Cria um convite de evento com confirmação de presença.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onEvento(@Context() [interaction]: SlashCommandContext) {
    const modal = new ModalBuilder()
      .setCustomId(`event_create/${interaction.channelId}`)
      .setTitle('Criar Evento')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('titulo').setLabel('Título do evento').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Person das 21h').setMaxLength(80).setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('descricao').setLabel('Descrição').setStyle(TextInputStyle.Paragraph).setPlaceholder('Detalhes do evento, regras, etc.').setMaxLength(300).setRequired(false),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('horario').setLabel('Horário (opcional)').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Hoje às 21h, Sábado 20:00').setMaxLength(50).setRequired(false),
        ),
      );

    await interaction.showModal(modal);
  }

  buildEventEmbed(creator: any, titulo: string, descricao: string | null, horario: string | null, goingNames: string[], notGoingNames: string[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`📅  ${titulo}`)
      .setColor(0x5865f2)
      .setFooter({ text: `Criado por ${creator.displayName ?? creator.username}` })
      .setThumbnail(creator.displayAvatarURL?.() ?? creator.displayAvatar?.url ?? null);

    if (descricao) embed.setDescription(descricao);
    if (horario) embed.addFields({ name: '🕐 Horário', value: horario, inline: false });
    embed.addFields(
      { name: `✅ Vou (${goingNames.length})`, value: goingNames.join('\n') || '*Ninguém ainda*', inline: true },
      { name: `❌ Não Vou (${notGoingNames.length})`, value: notGoingNames.join('\n') || '*Ninguém ainda*', inline: true },
    );

    return embed;
  }

  buildEventButtons(messageId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`event/vou/${messageId}`).setLabel('Vou').setStyle(ButtonStyle.Success).setEmoji('✅'),
      new ButtonBuilder().setCustomId(`event/nao_vou/${messageId}`).setLabel('Não Vou').setStyle(ButtonStyle.Danger).setEmoji('❌'),
      new ButtonBuilder().setCustomId(`event/criar/${messageId}`).setLabel('Criar Partida').setStyle(ButtonStyle.Primary).setEmoji('🎮'),
    );
  }
}
