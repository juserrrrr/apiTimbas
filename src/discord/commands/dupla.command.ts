import { Injectable } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext, UserOption } from 'necord';
import { EmbedBuilder, MessageFlags, User } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';
import { LeaderboardService } from '../../leaderboard/leaderboard.service';

class DuplaOptions {
  @UserOption({ name: 'jogador', description: 'Jogador para analisar (padrão: você)', required: false })
  jogador?: User;
}

@Injectable()
export class DuplaCommand {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  @SlashCommand({ name: 'dupla', description: 'Mostra com quem um jogador mais ganha (e mais perde) partidas.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onDupla(
    @Context() [interaction]: SlashCommandContext,
    @Options() { jogador }: DuplaOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = jogador ?? interaction.user;
    const user = await this.prisma.user.findUnique({ where: { discordId: target.id } });
    if (!user) {
      await interaction.editReply({ content: `❌ **${target.displayName ?? target.username}** ainda não jogou nenhuma partida registrada.` });
      return;
    }

    const duo = await this.leaderboardService.getDuoStats(interaction.guild!.id, user.id);
    const partners = duo.partners.filter((p) => p.games >= 2);

    if (partners.length === 0) {
      await interaction.editReply({ content: `❌ **${user.name}** ainda não tem duplas com pelo menos 2 partidas juntas.` });
      return;
    }

    const fmt = (wr: number) => `${Math.round(wr * 100)}%`;
    const best = partners.slice(0, 5)
      .map((p, i) => `${['🥇', '🥈', '🥉', '4.', '5.'][i]} **${p.name}** — ${p.wins}V/${p.losses}D juntos (${fmt(p.winRate)} WR)`)
      .join('\n');

    const worst = [...partners]
      .sort((a, b) => a.winRate - b.winRate || b.games - a.games)
      .slice(0, 2)
      .map((p) => `💔 **${p.name}** — ${p.wins}V/${p.losses}D juntos (${fmt(p.winRate)} WR)`)
      .join('\n');

    const rivals = duo.opponents
      .filter((o) => o.games >= 2)
      .slice(0, 3)
      .map((o) => `⚔️ **${o.name}** — enfrentado ${o.games}x, você venceu ${fmt(o.winRate)}`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`🤝 Duplas de ${user.name}`)
      .setColor(0x22c55e)
      .addFields(
        { name: '✨ Melhores parceiros', value: best },
        ...(worst ? [{ name: '🚫 Dupla amaldiçoada', value: worst }] : []),
        ...(rivals ? [{ name: '🎯 Rivais mais enfrentados', value: rivals }] : []),
      )
      .setFooter({ text: 'Considera duplas com 2+ partidas juntas nas personalizadas' });

    await interaction.editReply({ embeds: [embed] });
  }
}
