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

  @SlashCommand({ name: 'usuariolol', description: 'Busca informações de um jogador de League of Legends.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onUsuarioLol(
    @Context() [interaction]: SlashCommandContext,
    @Options() { nick, tag }: UsuarioLolOptions,
  ) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const data = await this.riotService.getPlayerInfo(nick, tag);
      if (!data) {
        await interaction.followUp({ content: '❌ Jogador não encontrado.', ephemeral: true });
        return;
      }

      const solo: any = (data as any).solo ?? {};
      const flex: any = (data as any).flex ?? {};

      const embed = new EmbedBuilder()
        .setTitle(`${data.gameName ?? nick}`)
        .setColor(0xc69b3a)
        .addFields(
          { name: 'Nível', value: String(data.summonerLevel ?? '?'), inline: true },
          { name: 'Solo/Duo', value: `${solo.tier ?? 'Unranked'} ${solo.rank ?? ''}`.trim(), inline: true },
          { name: 'Flex', value: `${flex.tier ?? 'Unranked'} ${flex.rank ?? ''}`.trim(), inline: true },
        );

      if (data.profileIconId) {
        const iconUrl = await this.riotService.buildChampionIconUrl('').catch(() => null);
        // use ddragon profile icon
        const version = '14.8.1';
        embed.setThumbnail(`https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${data.profileIconId}.png`);
      }

      await interaction.followUp({ embeds: [embed], ephemeral: true });
    } catch (e) {
      await interaction.followUp({ content: `❌ Erro ao buscar jogador: ${e}`, ephemeral: true });
    }
  }
}
