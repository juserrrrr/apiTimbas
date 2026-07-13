import { Injectable, Logger } from '@nestjs/common';
import { Context, IntegerOption, Options, SlashCommand, SlashCommandContext } from 'necord';
import { EmbedBuilder, MessageFlags, PermissionFlagsBits, Role } from 'discord.js';
import { LeaderboardService } from '../../leaderboard/leaderboard.service';
import { SeasonService, SeasonChampion } from '../../engagement/season.service';

const CHAMPION_ROLE_NAME = '🏆 Campeão da Temporada';

class TemporadaOptions {
  @IntegerOption({
    name: 'acao',
    description: 'O que fazer com a temporada',
    required: true,
    choices: [
      { name: 'Status da temporada atual', value: 0 },
      { name: 'Encerrar atual e iniciar a próxima', value: 1 },
    ],
  })
  acao: number;
}

@Injectable()
export class TemporadaCommand {
  private readonly logger = new Logger(TemporadaCommand.name);

  constructor(
    private readonly seasonService: SeasonService,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  @SlashCommand({ name: 'temporada', description: 'Gerencia as temporadas do ranking do servidor.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onTemporada(
    @Context() [interaction]: SlashCommandContext,
    @Options() { acao }: TemporadaOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const serverId = interaction.guild!.id;

    if (acao === 0) {
      const active = await this.seasonService.getActive(serverId);
      if (!active) {
        await interaction.editReply({ content: 'ℹ️ Este servidor ainda não usa temporadas — o ranking conta todas as partidas. Use `/temporada` → *Encerrar atual e iniciar a próxima* para abrir a Temporada 1 (isso zera o ranking).' });
        return;
      }
      const leaderboard = await this.leaderboardService.getLeaderboardForServer(serverId);
      const leader = leaderboard[0];
      await interaction.editReply({
        content: `📅 **Temporada ${active.number}** — começou <t:${Math.floor(active.startedAt.getTime() / 1000)}:R>.\n${leader ? `👑 Líder atual: **${leader.name}** (${leader.score} pts, ${leader.wins}V/${leader.losses}D)` : 'Ainda não há partidas nesta temporada.'}`,
      });
      return;
    }

    // encerrar/iniciar exige gerência do servidor
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.editReply({ content: '❌ Apenas quem gerencia o servidor pode encerrar/iniciar temporadas.' });
      return;
    }

    const active = await this.seasonService.getActive(serverId);
    const leaderboard = await this.leaderboardService.getLeaderboardForServer(serverId);
    const top3: SeasonChampion[] = leaderboard.slice(0, 3).map((p) => ({
      rank: p.rank,
      userId: p.userId,
      name: p.name,
      discordId: p.discordId,
      score: p.score,
      wins: p.wins,
      losses: p.losses,
    }));

    const { closed, started } = await this.seasonService.closeAndStartNext(serverId, top3);
    this.leaderboardService.invalidateServer(serverId);

    if (closed && top3.length > 0) {
      await this.assignChampionRole(interaction, top3[0].discordId).catch((e) =>
        this.logger.warn(`Falha ao atribuir cargo de campeão: ${e}`),
      );

      const medals = ['🥇', '🥈', '🥉'];
      const embed = new EmbedBuilder()
        .setTitle(`🏁 Fim da Temporada ${closed.number}!`)
        .setColor(0xffd700)
        .setDescription(
          top3.map((c, i) => `${medals[i]} **${c.name}** — ${c.score} pts (${c.wins}V/${c.losses}D)`).join('\n') +
          `\n\n👑 <@${top3[0].discordId}> recebeu o cargo **${CHAMPION_ROLE_NAME}**!\n\n▶️ A **Temporada ${started.number}** começa agora — ranking zerado, boa sorte!`,
        )
        .setTimestamp();
      await interaction.channel?.send({ embeds: [embed] }).catch(() => {});
      await interaction.editReply({ content: `✅ Temporada ${closed.number} encerrada e Temporada ${started.number} iniciada!` });
    } else if (closed) {
      await interaction.editReply({ content: `✅ Temporada ${closed.number} encerrada (sem jogadores no ranking) e Temporada ${started.number} iniciada.` });
    } else {
      await interaction.channel?.send({ content: `📅 **Temporada ${started.number} iniciada!** O ranking foi zerado — toda partida a partir de agora vale pontos da nova temporada. 🍀` }).catch(() => {});
      await interaction.editReply({ content: `✅ Temporada ${started.number} iniciada! O ranking passa a contar apenas as partidas a partir de agora.` });
    }
  }

  private async assignChampionRole(interaction: any, championDiscordId: string): Promise<void> {
    const guild = interaction.guild;
    let role: Role | undefined = guild.roles.cache.find((r: Role) => r.name === CHAMPION_ROLE_NAME);
    if (!role) {
      role = await guild.roles.create({ name: CHAMPION_ROLE_NAME, color: 0xffd700, hoist: true, reason: 'Campeão da temporada Timbas' });
    }

    // remove o cargo dos detentores anteriores
    for (const member of role!.members.values()) {
      await member.roles.remove(role!).catch(() => {});
    }

    const champion = await guild.members.fetch(championDiscordId).catch(() => null);
    if (champion) await champion.roles.add(role!).catch(() => {});
  }
}
