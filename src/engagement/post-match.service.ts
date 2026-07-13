import { Injectable, Logger } from '@nestjs/common';
import {
  ActionRowBuilder,
  ChannelType,
  Client,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
} from 'discord.js';
import { BetStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { WalletService } from './wallet.service';
import { AchievementService, UnlockedAchievement } from './achievement.service';

const MATCH_TYPE_LABELS: Record<string, string> = {
  ALEATORIO: 'Aleatório',
  LIVRE: 'Livre',
  BALANCEADO: 'Balanceado',
  ALEATORIO_COMPLETO: 'Aleatório Completo',
};

const REWARD_PARTICIPATION = 10;
const REWARD_WIN = 10;
const REWARD_MVP = 25;
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
    private readonly walletService: WalletService,
    private readonly achievementService: AchievementService,
  ) {}

  /**
   * Fluxo pós-partida (fire-and-forget a partir do finish):
   * resolve apostas, paga fichas, checa conquistas, gera recap de IA e abre votação de MVP.
   */
  async onMatchFinished(match: any): Promise<void> {
    try {
      const serverId: string = match.ServerDiscordId;
      const channel = this.getMatchChannel(serverId);
      if (!channel) return;

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
      const mvpPromise = this.runMvpVote(channel, match.id, serverId, winners, allPlayers).catch((e) => {
        this.logger.warn(`Votação de MVP falhou (match ${match.id}): ${e}`);
        return null;
      });

      const [betLines, achievements] = await Promise.all([
        this.resolveBets(match.id, serverId, winnerSide),
        this.achievementService.checkAndUnlock(serverId, allPlayers),
        this.payParticipation(serverId, allPlayers, winners),
      ]);

      const recap = await this.aiService.generateMatchRecap({
        matchId: match.id,
        matchTypeLabel: MATCH_TYPE_LABELS[match.matchType] ?? match.matchType,
        playersPerTeam: match.playersPerTeam,
        blueTeam: bluePlayers.map((p) => p.name),
        redTeam: redPlayers.map((p) => p.name),
        winnerSide,
        streakNotes: achievements.map((a) => `${a.name}: ${a.label}`),
      });

      await this.sendResultEmbed(channel, match, winnerSide, recap, betLines, achievements);

      await mvpPromise;
    } catch (e) {
      this.logger.error(`Fluxo pós-partida falhou (match ${match?.id}): ${e}`);
    }
  }

  /** Devolve fichas de apostas pendentes (partida cancelada/expirada). */
  async refundPendingBets(matchId: number): Promise<void> {
    try {
      const pending = await this.prisma.bet.findMany({ where: { matchId, status: BetStatus.PENDING } });
      for (const bet of pending) {
        await this.prisma.bet.update({ where: { id: bet.id }, data: { status: BetStatus.REFUNDED } });
        await this.walletService.credit(bet.serverId, bet.discordId, bet.amount);
      }
      if (pending.length > 0) {
        this.logger.log(`${pending.length} aposta(s) reembolsada(s) da partida ${matchId}.`);
      }
    } catch (e) {
      this.logger.warn(`Falha ao reembolsar apostas da partida ${matchId}: ${e}`);
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

  private async resolveBets(matchId: number, serverId: string, winnerSide: 'BLUE' | 'RED'): Promise<string[]> {
    const bets = await this.prisma.bet.findMany({ where: { matchId, status: BetStatus.PENDING } });
    const lines: string[] = [];

    for (const bet of bets) {
      const won = bet.side === winnerSide;
      await this.prisma.bet.update({
        where: { id: bet.id },
        data: { status: won ? BetStatus.WON : BetStatus.LOST },
      });
      if (won) {
        await this.walletService.credit(serverId, bet.discordId, bet.amount * 2);
        lines.push(`💰 <@${bet.discordId}> acertou e faturou **${bet.amount * 2}** fichas!`);
      } else {
        lines.push(`💸 <@${bet.discordId}> perdeu **${bet.amount}** fichas...`);
      }
    }

    return lines;
  }

  private async payParticipation(serverId: string, allPlayers: MatchPlayer[], winners: MatchPlayer[]): Promise<void> {
    const winnerIds = new Set(winners.map((p) => p.discordId));
    for (const player of allPlayers) {
      const amount = REWARD_PARTICIPATION + (winnerIds.has(player.discordId) ? REWARD_WIN : 0);
      await this.walletService.credit(serverId, player.discordId, amount).catch(() => {});
    }
  }

  private async sendResultEmbed(
    channel: TextChannel,
    match: any,
    winnerSide: 'BLUE' | 'RED',
    recap: string,
    betLines: string[],
    achievements: UnlockedAchievement[],
  ): Promise<void> {
    const winnerLabel = winnerSide === 'BLUE' ? '🔵 Time Azul' : '🔴 Time Vermelho';
    const embed = new EmbedBuilder()
      .setTitle(`🏁 Partida #${match.id} — vitória do ${winnerLabel}!`)
      .setColor(winnerSide === 'BLUE' ? 0x3b82f6 : 0xef4444)
      .setDescription(recap)
      .setFooter({ text: `Cada jogador ganhou 🪙 ${REWARD_PARTICIPATION} fichas (+${REWARD_WIN} pros vencedores)` })
      .setTimestamp();

    if (achievements.length > 0) {
      embed.addFields({
        name: '🏆 Conquistas desbloqueadas',
        value: achievements.slice(0, 8).map((a) => `${a.emoji} **${a.name}** — ${a.label}`).join('\n'),
      });
    }

    if (betLines.length > 0) {
      embed.addFields({
        name: '🎰 Apostas',
        value: betLines.slice(0, 10).join('\n'),
      });
    }

    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  private async runMvpVote(
    channel: TextChannel,
    matchId: number,
    serverId: string,
    winners: MatchPlayer[],
    allPlayers: MatchPlayer[],
  ): Promise<void> {
    if (winners.length < 2) return; // 1v1 não tem votação

    const select = new StringSelectMenuBuilder()
      .setCustomId(`mvpvote/${matchId}`)
      .setPlaceholder('Vote no MVP do time vencedor...')
      .addOptions(
        winners.map((p) =>
          new StringSelectMenuOptionBuilder().setLabel(p.name.slice(0, 100)).setValue(String(p.userId)),
        ),
      );
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const embed = new EmbedBuilder()
      .setTitle(`⭐ MVP da partida #${matchId}`)
      .setColor(0xfbbf24)
      .setDescription(`Jogadores da partida: votem no MVP do time vencedor!\nA votação fecha em **${MVP_VOTE_WINDOW_MS / 1000}s** — o MVP leva 🪙 **${REWARD_MVP}** fichas.`);

    const message = await channel.send({ embeds: [embed], components: [row] });

    const participantIds = new Set(allPlayers.map((p) => p.discordId));
    const votes = new Map<string, number>(); // voterDiscordId -> votedUserId

    const collector = message.createMessageComponentCollector({ time: MVP_VOTE_WINDOW_MS });
    collector.on('collect', async (i: any) => {
      if (!participantIds.has(i.user.id)) {
        await i.reply({ content: '❌ Só quem jogou a partida pode votar.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      votes.set(i.user.id, Number(i.values[0]));
      await i.reply({ content: '✅ Voto registrado!', flags: MessageFlags.Ephemeral }).catch(() => {});
    });

    await new Promise<void>((resolve) => collector.on('end', () => resolve()));

    const tally = new Map<number, number>();
    for (const votedId of votes.values()) tally.set(votedId, (tally.get(votedId) ?? 0) + 1);

    if (tally.size === 0) {
      const noVotes = EmbedBuilder.from(embed)
        .setDescription('Ninguém votou... partida sem MVP. 😴')
        .setColor(0x6b7280);
      await message.edit({ embeds: [noVotes], components: [] }).catch(() => {});
      return;
    }

    const [mvpUserId, voteCount] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    const mvp = winners.find((p) => p.userId === mvpUserId);
    if (!mvp) return;

    await this.prisma.customLeagueMatch.update({ where: { id: matchId }, data: { mvpUserId } }).catch(() => {});
    await this.walletService.credit(serverId, mvp.discordId, REWARD_MVP).catch(() => {});

    const result = EmbedBuilder.from(embed)
      .setDescription(`👑 O MVP da partida é <@${mvp.discordId}> com **${voteCount}** voto(s)!\nLevou 🪙 **${REWARD_MVP}** fichas de bônus.`)
      .setColor(0xfbbf24);
    await message.edit({ embeds: [result], components: [] }).catch(() => {});
  }
}
