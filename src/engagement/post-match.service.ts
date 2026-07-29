import { Injectable, Logger } from '@nestjs/common';
import {
  ActionRowBuilder,
  ChannelType,
  Client,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
} from 'discord.js';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { AchievementService, UnlockedAchievement } from './achievement.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';

const MATCH_TYPE_LABELS: Record<string, string> = {
  ALEATORIO: 'Aleatório',
  LIVRE: 'Livre',
  BALANCEADO: 'Balanceado',
  ALEATORIO_COMPLETO: 'Aleatório Completo',
};

const MVP_VOTE_WINDOW_MS = 90_000;

interface MatchPlayer {
  userId: number;
  discordId: string;
  name: string;
}

@Injectable()
export class PostMatchService {
  private readonly logger = new Logger(PostMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: Client,
    private readonly aiService: AiService,
    private readonly achievementService: AchievementService,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  /**
   * Fluxo pós-partida (fire-and-forget a partir do finish):
   * Checa conquistas, gera o recap e abre a votação de MVP.
   */
  async onMatchFinished(match: any): Promise<void> {
    try {
      const serverId: string = match.ServerDiscordId;
      const channel = this.getMatchChannel(serverId);

      const blueTeam = match.Teams?.find((t: any) => t.id === match.teamBlueId);
      const redTeam = match.Teams?.find((t: any) => t.id === match.teamRedId);
      const winnerSide: 'BLUE' | 'RED' = match.winnerId === match.teamBlueId ? 'BLUE' : 'RED';

      const mapPlayers = (team: any): MatchPlayer[] =>
        (team?.players ?? [])
          .filter((p: any) => p.user?.discordId)
          .map((p: any) => ({ userId: p.user.id, discordId: p.user.discordId, name: p.user.name }));

      const bluePlayers = mapPlayers(blueTeam);
      const redPlayers = mapPlayers(redTeam);
      const allPlayers = [...bluePlayers, ...redPlayers];
      const winners = winnerSide === 'BLUE' ? bluePlayers : redPlayers;
      if (allPlayers.length === 0) return;

      // MVP primeiro (mensagem imediata); o restante roda em paralelo
      const mvpPromise = this.runMvpVote(match.id, serverId, winners, allPlayers).catch((e) => {
        this.logger.warn(`Votação de MVP falhou (match ${match.id}): ${e}`);
        return null;
      });

      const achievements = await this.achievementService.checkAndUnlock(serverId, allPlayers);

      const recap = await this.aiService.generateMatchRecap({
        matchId: match.id,
        matchTypeLabel: MATCH_TYPE_LABELS[match.matchType] ?? match.matchType,
        playersPerTeam: match.playersPerTeam,
        blueTeam: bluePlayers.map((p) => p.name),
        redTeam: redPlayers.map((p) => p.name),
        winnerSide,
        streakNotes: achievements.map((a) => `${a.name}: ${a.label}`),
      });

      if (channel) {
        await this.sendResultEmbed(channel, match, winnerSide, recap, achievements);
      }

      await mvpPromise;
    } catch (e) {
      this.logger.error(`Fluxo pós-partida falhou (match ${match?.id}): ${e}`);
    }
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private getMatchChannel(serverId: string): TextChannel | null {
    const guild = this.client.guilds.cache.get(serverId);
    if (!guild) return null;
    return (guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === 'custom_game',
    ) as TextChannel | undefined) ?? null;
  }

  private async sendResultEmbed(
    channel: TextChannel,
    match: any,
    winnerSide: 'BLUE' | 'RED',
    recap: string,
    achievements: UnlockedAchievement[],
  ): Promise<void> {
    const winnerLabel = winnerSide === 'BLUE' ? '🔵 Time Azul' : '🔴 Time Vermelho';
    const embed = new EmbedBuilder()
      .setTitle(`🏁 Partida #${match.id} — vitória do ${winnerLabel}!`)
      .setColor(winnerSide === 'BLUE' ? 0x3b82f6 : 0xef4444)
      .setDescription(recap)
      .setTimestamp();

    if (achievements.length > 0) {
      embed.addFields({
        name: '🏆 Conquistas desbloqueadas',
        value: achievements.slice(0, 8).map((a) => `${a.emoji} **${a.name}** — ${a.label}`).join('\n'),
      });
    }

    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  /** Envia a cada participante somente um select na DM com os vencedores. */
  private async runMvpVote(
    matchId: number,
    serverId: string,
    winners: MatchPlayer[],
    allPlayers: MatchPlayer[],
  ): Promise<void> {
    if (winners.length < 2) return; // 1v1 não tem em quem votar

    const ballotText = `Quem foi o MVP da partida #${matchId}?`;

    const ballotRow = (disabled = false, selectedUserId?: number) =>
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`mvpvote/${matchId}`)
          .setPlaceholder(disabled ? 'Votação encerrada' : 'Escolha o MVP do time vencedor')
          .setDisabled(disabled)
          .addOptions(
            winners.map((p) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(p.name.slice(0, 100))
                .setValue(String(p.userId))
                .setDefault(p.userId === selectedUserId),
            ),
          ),
      );

    // Quem estiver com a DM fechada fica de fora da votação.
    const sent = await Promise.all(
      allPlayers.map(async (player) => {
        try {
          const user = await this.client.users.fetch(player.discordId);
          return await user.send({ content: ballotText, components: [ballotRow()] });
        } catch {
          this.logger.warn(`Cédula de MVP não entregue a ${player.discordId} (DM fechada?).`);
          return null;
        }
      }),
    );
    const delivered = sent.filter((m): m is NonNullable<typeof m> => m !== null);
    if (delivered.length === 0) return;

    const votes = new Map<string, number>(); // voterDiscordId -> votedUserId
    const candidateIds = new Set(winners.map((player) => player.userId));

    await Promise.all(
      delivered.map(
        (message) =>
          new Promise<void>((resolve) => {
            const collector = message.createMessageComponentCollector({ time: MVP_VOTE_WINDOW_MS });
            collector.on('collect', async (i: any) => {
              const votedUserId = Number(i.values[0]);
              if (!candidateIds.has(votedUserId)) {
                await i.deferUpdate().catch(() => {});
                return;
              }
              votes.set(i.user.id, votedUserId);
              const voted = winners.find((player) => player.userId === votedUserId);
              await i
                .update({
                  content: `Voto registrado para ${voted?.name ?? 'o jogador selecionado'} na partida #${matchId}.`,
                  components: [ballotRow(true, votedUserId)],
                })
                .catch(() => {});
              collector.stop('voted');
            });
            collector.on('end', () => resolve());
          }),
      ),
    );

    const tally = new Map<number, number>();
    for (const votedId of votes.values()) tally.set(votedId, (tally.get(votedId) ?? 0) + 1);

    if (tally.size === 0) {
      await this.closeBallots(
        delivered,
        `A votação de MVP da partida #${matchId} terminou sem votos.`,
        ballotRow(true),
      );
      return;
    }

    const [mvpUserId, voteCount] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    const mvp = winners.find((p) => p.userId === mvpUserId);
    if (!mvp) return;

    await this.prisma.customLeagueMatch.update({ where: { id: matchId }, data: { mvpUserId } });
    this.leaderboardService.invalidateServer(serverId);
    await this.closeBallots(
      delivered,
      `O MVP da partida #${matchId} foi ${mvp.name}, com ${voteCount} voto(s).`,
      ballotRow(true, mvpUserId),
    );

    this.logger.log(`MVP da partida ${matchId}: ${mvp.name} (${voteCount} voto(s)).`);
  }

  /** Desativa as cédulas na DM quando a votação termina. */
  private async closeBallots(
    messages: any[],
    content: string,
    row: ActionRowBuilder<StringSelectMenuBuilder>,
  ): Promise<void> {
    await Promise.all(
      messages.map((message) => message.edit({ content, components: [row] }).catch(() => {})),
    );
  }
}
