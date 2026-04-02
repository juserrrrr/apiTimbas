import { Injectable } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext, UserOption } from 'necord';
import { EmbedBuilder, GuildMember, Colors, MessageFlags } from 'discord.js';
import { LeaderboardService } from '../../leaderboard/leaderboard.service';

class VersusOptions {
  @UserOption({ name: 'jogador1', description: 'Primeiro jogador', required: true })
  jogador1: GuildMember;

  @UserOption({ name: 'jogador2', description: 'Segundo jogador', required: true })
  jogador2: GuildMember;
}

@Injectable()
export class VersusCommand {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @SlashCommand({ name: 'versus', description: 'Compara as estatísticas de dois jogadores do servidor.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onVersus(
    @Context() [interaction]: SlashCommandContext,
    @Options() { jogador1, jogador2 }: VersusOptions,
  ) {
    await interaction.deferReply();

    if (jogador1.id === jogador2.id) {
      const msg = await interaction.followUp({ content: 'Selecione dois jogadores diferentes.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const serverId = interaction.guild!.id;
    const ranking = await this.leaderboardService.getLeaderboardForServer(serverId);

    const findPlayer = (member: GuildMember) => {
      // Search by name first (like Python), then by discordId
      const byName = ranking.find((p: any) => (p.name ?? '').toLowerCase() === member.user.username.toLowerCase());
      if (byName) return byName;
      return ranking.find((p: any) => p.discordId === member.id || String(p.userId) === member.id) ?? null;
    };

    const extractStats = (data: any, member: GuildMember) => {
      if (!data) return null;
      const wins = data.wins ?? 0;
      const losses = data.losses ?? 0;
      const total = data.totalGames ?? wins + losses;
      let winRate = data.winRate ?? (total > 0 ? wins / total : 0);
      if (winRate > 1) winRate = winRate / 100;
      return {
        name: (data.name ?? member.displayName).slice(0, 12),
        wins,
        losses,
        total,
        winRate: winRate * 100,
      };
    };

    const p1Raw = findPlayer(jogador1);
    const p2Raw = findPlayer(jogador2);
    const s1 = extractStats(p1Raw, jogador1);
    const s2 = extractStats(p2Raw, jogador2);

    if (!s1 && !s2) {
      const msg = await interaction.followUp({ content: 'Nenhum dos jogadores possui estatísticas registradas.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const name1 = s1?.name ?? jogador1.displayName.slice(0, 12);
    const name2 = s2?.name ?? jogador2.displayName.slice(0, 12);

    const statOrDash = (stats: any, key: string) => (stats == null ? '-' : String(stats[key]));
    const wrOrDash = (stats: any) => (stats == null ? '-' : `${stats.winRate.toFixed(1)}%`);
    const winnerIcon = (v1: number | null, v2: number | null, higherIsBetter = true): string => {
      if (v1 == null || v2 == null) return ' ';
      if (higherIsBetter) return v1 > v2 ? '<' : v2 > v1 ? '>' : '=';
      return v1 < v2 ? '<' : v2 < v1 ? '>' : '=';
    };

    const col = 12;
    const sep = '─'.repeat(col * 2 + 13);
    const lines = [
      `${''.padEnd(col)}  ${'VS'.padStart(5).padEnd(7)}  ${''.padEnd(col)}`,
      `${name1.padEnd(col)}  ${''.padStart(3).padEnd(7)}  ${name2.padEnd(col)}`,
      sep,
      `${'Vitórias'.padEnd(col)}  ${winnerIcon(s1?.wins ?? null, s2?.wins ?? null).padStart(3).padEnd(7)}  ${'Vitórias'.padEnd(col)}`,
      `${statOrDash(s1, 'wins').padEnd(col)}  ${''.padStart(3).padEnd(7)}  ${statOrDash(s2, 'wins').padEnd(col)}`,
      sep,
      `${'Derrotas'.padEnd(col)}  ${winnerIcon(s1?.losses ?? null, s2?.losses ?? null, false).padStart(3).padEnd(7)}  ${'Derrotas'.padEnd(col)}`,
      `${statOrDash(s1, 'losses').padEnd(col)}  ${''.padStart(3).padEnd(7)}  ${statOrDash(s2, 'losses').padEnd(col)}`,
      sep,
      `${'Total'.padEnd(col)}  ${winnerIcon(s1?.total ?? null, s2?.total ?? null).padStart(3).padEnd(7)}  ${'Total'.padEnd(col)}`,
      `${statOrDash(s1, 'total').padEnd(col)}  ${''.padStart(3).padEnd(7)}  ${statOrDash(s2, 'total').padEnd(col)}`,
      sep,
      `${'WinRate'.padEnd(col)}  ${winnerIcon(s1?.winRate ?? null, s2?.winRate ?? null).padStart(3).padEnd(7)}  ${'WinRate'.padEnd(col)}`,
      `${wrOrDash(s1).padEnd(col)}  ${''.padStart(3).padEnd(7)}  ${wrOrDash(s2).padEnd(col)}`,
    ];

    let footer: string;
    if (s1 && s2) {
      footer = s1.winRate > s2.winRate ? `Melhor WinRate: ${name1}` : s2.winRate > s1.winRate ? `Melhor WinRate: ${name2}` : 'WinRates iguais';
    } else {
      footer = 'Dados incompletos';
    }

    const embed = new EmbedBuilder()
      .setTitle(`⚔️  ${name1}  vs  ${name2}`)
      .setDescription('```\n' + lines.join('\n') + '\n```')
      .setColor(Colors.Purple)
      .setFooter({ text: footer })
      .setThumbnail(jogador1.displayAvatarURL());

    await interaction.followUp({ embeds: [embed] });
  }
}
