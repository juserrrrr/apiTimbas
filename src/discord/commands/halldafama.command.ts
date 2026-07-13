import { Injectable } from '@nestjs/common';
import { Context, SlashCommand, SlashCommandContext } from 'necord';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { SeasonService, SeasonChampion } from '../../engagement/season.service';

@Injectable()
export class HallDaFamaCommand {
  constructor(private readonly seasonService: SeasonService) {}

  @SlashCommand({ name: 'halldafama', description: 'Mostra os campeões das temporadas passadas.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onHallDaFama(@Context() [interaction]: SlashCommandContext) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const seasons = await this.seasonService.listClosed(interaction.guild!.id, 10);
    if (seasons.length === 0) {
      await interaction.editReply({ content: 'Ainda não há temporadas encerradas. O hall da fama espera seu primeiro campeão! 👑' });
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const blocks = seasons.map((s) => {
      const champions = (s.champions as unknown as SeasonChampion[] | null) ?? [];
      const period = `<t:${Math.floor(s.startedAt.getTime() / 1000)}:d> → <t:${Math.floor((s.endedAt ?? new Date()).getTime() / 1000)}:d>`;
      const podium = champions.length > 0
        ? champions.slice(0, 3).map((c, i) => `${medals[i]} **${c.name}** (${c.score} pts)`).join(' · ')
        : '_sem jogadores ranqueados_';
      return `**Temporada ${s.number}** (${period})\n${podium}`;
    });

    const embed = new EmbedBuilder()
      .setTitle('🏛️ Hall da Fama')
      .setColor(0xffd700)
      .setDescription(blocks.join('\n\n'))
      .setFooter({ text: 'Campeões das temporadas de partidas personalizadas' });

    await interaction.channel!.send({ embeds: [embed] }).catch(() => {});
    await interaction.editReply({ content: '✅ Hall da fama publicado!' });
  }
}
