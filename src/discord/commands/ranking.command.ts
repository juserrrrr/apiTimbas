import { Injectable } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext, BooleanOption } from 'necord';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { LeaderboardService } from '../../leaderboard/leaderboard.service';

class RankingOptions {
  @BooleanOption({ name: 'debug', description: 'Gera um ranking com jogadores falsos (apenas dono do servidor)', required: false })
  debug?: boolean;
}

@Injectable()
export class RankingCommand {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @SlashCommand({ name: 'ranking', description: 'Mostra o ranking dos 10 melhores jogadores do servidor.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onRanking(
    @Context() [interaction]: SlashCommandContext,
    @Options() { debug }: RankingOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let rankingData: any[];

    if (debug) {
      if (interaction.user.id !== interaction.guild!.ownerId) {
        const msg = await interaction.followUp({ content: 'Você não tem permissão para usar o modo de debug.', flags: MessageFlags.Ephemeral });
        setTimeout(() => msg.delete().catch(() => {}), 5000);
        return;
      }
      rankingData = Array.from({ length: 10 }, (_, i) => {
        const wins = 10 + Math.floor(Math.random() * 40);
        const losses = 5 + Math.floor(Math.random() * 25);
        return { rank: i + 1, name: `DebugPlayer${i + 1}`, wins, losses, winRate: wins / (wins + losses), totalGames: wins + losses };
      });
    } else {
      rankingData = await this.leaderboardService.getLeaderboardForServer(interaction.guild!.id);
    }

    if (!rankingData?.length) {
      const msg = await interaction.followUp({ content: 'Ainda não há jogadores no ranking deste servidor.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    const totalWidth = 45;
    const headerLines = [
      '----- TOP 10 -----'.padStart(28).padEnd(totalWidth),
      'Melhores do Servidor'.padStart(30).padEnd(totalWidth),
      '',
      `${'Pos.'.padEnd(5)}${'Jogador'.padEnd(15)}${'V/D'.padEnd(8)}${'Total'.padEnd(6)}${'WR'.padEnd(8)}`,
      '---------------------------------------------',
    ];

    const rankLines = rankingData.map((p, i) => {
      const rank = p.rank ?? i + 1;
      const name = (p.name ?? 'N/A').length > 15 ? (p.name ?? 'N/A').slice(0, 12) + '...' : (p.name ?? 'N/A');
      const wins = p.wins ?? 0;
      const losses = p.losses ?? 0;
      const wr = ((p.winRate ?? 0) * 100).toFixed(1);
      const total = p.totalGames ?? 0;
      const medal = rank === 1 ? ' 🥇' : rank === 2 ? ' 🥈' : rank === 3 ? ' 🥉' : '';
      return `${String(rank + '.').padStart(3).padEnd(5)}${name.padEnd(15)}${`${wins}/${losses}`.padEnd(8)}${String(total).padEnd(6)}${`${wr}%`.padEnd(8)}${medal}`;
    });

    const embed = new EmbedBuilder()
      .setTitle('🏆 Ranking de Jogadores 🏆')
      .setColor(0xffd700)
      .setDescription('```\n' + [...headerLines, ...rankLines].join('\n') + '\n```')
      .setFooter({ text: 'Os melhores jogadores do servidor com base nas partidas personalizadas.' });

    await interaction.channel!.send({ embeds: [embed] });
    const msg = await interaction.followUp({ content: 'Comando de ranking executado com sucesso!', flags: MessageFlags.Ephemeral });
    setTimeout(() => msg.delete().catch(() => {}), 5000);
  }
}
