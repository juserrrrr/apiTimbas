import { Injectable } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext, UserOption } from 'necord';
import { EmbedBuilder, GuildMember } from 'discord.js';
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

  @SlashCommand({ name: 'versus', description: 'Compara as estatísticas de dois jogadores.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onVersus(
    @Context() [interaction]: SlashCommandContext,
    @Options() { jogador1, jogador2 }: VersusOptions,
  ) {
    await interaction.deferReply();

    const serverId = interaction.guild!.id;
    const ranking = await this.leaderboardService.getLeaderboardForServer(serverId);

    const getStats = (userId: string) =>
      ranking.find((p: any) => p.discordId === userId || p.userId === userId);

    const s1 = getStats(jogador1.id);
    const s2 = getStats(jogador2.id);

    if (!s1 || !s2) {
      await interaction.editReply('❌ Um ou ambos os jogadores não possuem estatísticas registradas neste servidor.');
      return;
    }

    const wr1 = (s1.winRate ?? 0) * 100;
    const wr2 = (s2.winRate ?? 0) * 100;
    const winner = wr1 > wr2 ? jogador1.displayName : wr2 > wr1 ? jogador2.displayName : null;

    const symbol = wr1 > wr2 ? '>' : wr1 < wr2 ? '<' : '=';

    const lines = [
      `${'Stat'.padEnd(12)}${'P1'.padEnd(10)}${''.padEnd(3)}${'P2'.padEnd(10)}`,
      '─'.repeat(35),
      `${'Vitórias'.padEnd(12)}${String(s1.wins ?? 0).padEnd(10)}${''.padEnd(3)}${String(s2.wins ?? 0).padEnd(10)}`,
      `${'Derrotas'.padEnd(12)}${String(s1.losses ?? 0).padEnd(10)}${''.padEnd(3)}${String(s2.losses ?? 0).padEnd(10)}`,
      `${'Total'.padEnd(12)}${String(s1.totalGames ?? 0).padEnd(10)}${''.padEnd(3)}${String(s2.totalGames ?? 0).padEnd(10)}`,
      `${'Win Rate'.padEnd(12)}${`${wr1.toFixed(1)}%`.padEnd(10)}${symbol.padEnd(3)}${`${wr2.toFixed(1)}%`.padEnd(10)}`,
    ];

    const embed = new EmbedBuilder()
      .setTitle(`${jogador1.displayName} VS ${jogador2.displayName}`)
      .setDescription('```\n' + lines.join('\n') + '\n```')
      .setColor(0x5865f2)
      .setFooter({ text: winner ? `Melhor win rate: ${winner}` : 'Empate!' });

    await interaction.editReply({ embeds: [embed] });
  }
}
