import { Injectable } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext, IntegerOption } from 'necord';
import { TextChannel, MessageFlags } from 'discord.js';

class ApagarOptions {
  @IntegerOption({ name: 'quantidade', description: 'Número de mensagens a apagar', required: true, min_value: 1, max_value: 100 })
  quantidade: number;
}

@Injectable()
export class ApagarCommand {
  @SlashCommand({ name: 'apagar', description: 'Apaga as últimas N mensagens do canal.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onApagar(
    @Context() [interaction]: SlashCommandContext,
    @Options() { quantidade }: ApagarOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.channel as TextChannel;
    await channel.bulkDelete(quantidade, true);
    const msg = await interaction.followUp({ content: `✅ ${quantidade} mensagens apagadas.`, flags: MessageFlags.Ephemeral });
    setTimeout(() => msg.delete().catch(() => {}), 5000);
  }
}
