import { Injectable } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext, StringOption } from 'necord';
import { EmbedBuilder, MessageFlags } from 'discord.js';

class AnunciarOptions {
  @StringOption({ name: 'mensagem', description: 'Mensagem do anúncio', required: true })
  mensagem: string;
}

@Injectable()
export class AnunciarCommand {
  @SlashCommand({ name: 'anunciar', description: 'Encaminha um anuncio para o canal onde foi executado o comando.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onAnunciar(
    @Context() [interaction]: SlashCommandContext,
    @Options() { mensagem }: AnunciarOptions,
  ) {
    const embed = new EmbedBuilder()
      .setTitle('🚨 │ **Anuncio**')
      .setDescription(`**${mensagem}**`)
      .setColor(0xFF0004);

    const iconUrl = interaction.guild?.icon
      ? interaction.guild.iconURL({ extension: 'png' }) ?? undefined
      : undefined;
    if (iconUrl) embed.setThumbnail(iconUrl);

    await interaction.reply({ content: 'Comando executado com sucesso!', flags: MessageFlags.Ephemeral });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);

    await interaction.channel!.send({ content: '||@everyone||' });
    await interaction.channel!.send({ embeds: [embed] });
  }
}
