import { Injectable } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext, StringOption } from 'necord';
import { EmbedBuilder } from 'discord.js';
import { RiotService } from '../../riot/riot.service';

class UsuarioLolOptions {
  @StringOption({ name: 'nick', description: 'Nome de usuário do LoL', required: true })
  nick: string;

  @StringOption({ name: 'tag', description: 'Tag do LoL (ex: BR1)', required: true })
  tag: string;
}

@Injectable()
export class UsuarioLolCommand {
  constructor(private readonly riotService: RiotService) {}

  @SlashCommand({ name: 'usuariolol', description: 'Mostra as informações de determinado usuario do lol', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onUsuarioLol(
    @Context() [interaction]: SlashCommandContext,
    @Options() { nick, tag }: UsuarioLolOptions,
  ) {
    const guildIconUrl = interaction.guild?.icon
      ? interaction.guild.iconURL({ extension: 'png' }) ?? undefined
      : undefined;

    const embed = new EmbedBuilder()
      .setTitle('🔷 │ **Usuário não encontrado**')
      .setDescription('Por favor, tente novamente')
      .setColor(0xFF0004);
    if (guildIconUrl) embed.setThumbnail(guildIconUrl);

    await interaction.deferReply();

    try {
      const data = await this.riotService.getPlayerInfo(nick, tag);
      if (data) {
        const solo: any = (data as any).solo ?? {};
        const flex: any = (data as any).flex ?? {};

        const soloDuoStats = solo.tier && solo.tier !== 'Unranked'
          ? `${solo.tier} ${solo.rank ?? ''}`.trim()
          : 'Unranked';
        const flexStats = flex.tier && flex.tier !== 'Unranked'
          ? `${flex.tier} ${flex.rank ?? ''}`.trim()
          : 'Unranked';

        embed
          .setTitle(`🔷 │ **${data.gameName ?? nick}#${tag}**`)
          .setDescription('**Informações sobre o jogador**')
          .spliceFields(0, embed.data.fields?.length ?? 0)
          .addFields(
            { name: 'Solo/Duo', value: soloDuoStats, inline: true },
            { name: 'Flex', value: flexStats, inline: true },
            { name: 'Level', value: String(data.summonerLevel ?? '?'), inline: true },
          );

        const iconUrl = (data as any).profileIconUrl ?? guildIconUrl;
        if (iconUrl) embed.setThumbnail(iconUrl);
      }
    } catch {}

    await interaction.editReply({ embeds: [embed] });
  }
}
