import { Injectable } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext, StringOption } from 'necord';
import { EmbedBuilder } from 'discord.js';

class AnunciarOptions {
  @StringOption({ name: 'mensagem', description: 'Mensagem do anúncio', required: true })
  mensagem: string;
}

@Injectable()
export class AnunciarCommand {
  @SlashCommand({ name: 'anunciar', description: 'Faz um anúncio no canal atual.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onAnunciar(
    @Context() [interaction]: SlashCommandContext,
    @Options() { mensagem }: AnunciarOptions,
  ) {
    const embed = new EmbedBuilder()
      .setTitle('📢 Anúncio')
      .setDescription(mensagem)
      .setColor(0x5865f2)
      .setFooter({ text: `Anunciado por ${interaction.user.displayName}` });

    await interaction.channel!.send({ content: '||@everyone||', embeds: [embed] });
    await interaction.reply({ content: 'Anúncio enviado!', ephemeral: true });
  }
}
