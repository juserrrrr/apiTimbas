import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DraftBudgetTxType,
  DraftLeague,
  DraftMatchStatus,
  MatchProofStatus,
  Prisma,
} from '@prisma/client';
import { Actor } from '../common/actor.service';
import { createHash } from 'crypto';
import { DraftBudgetService } from './draft-budget.service';
import { overallFromAttributes } from '../football/attributes';
import { applyChange, attributeChange, nextForm, nextRatingAvg } from '../football/development';
import { PlayerPerformance, SimulatedMatch } from '../football/match-simulation';
import { PrismaService } from '../prisma/prisma.service';
import { ScoreReaderService } from '../score-reader/score-reader.service';
import { DraftAccessService } from './draft-access.service';
import { ReportDraftResultDto, ScorerDto } from './dto/draft.dto';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const AUTO_APPROVE_MIN_CONFIDENCE = 80;

@Injectable()
export class DraftFixtureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DraftAccessService,
    private readonly budget: DraftBudgetService,
    private readonly reader: ScoreReaderService,
  ) {}

  async listMatches(leagueId: string, round?: number) {
    return this.prisma.draftMatch.findMany({
      where: { leagueId, ...(round ? { round } : {}) },
      orderBy: [{ round: 'asc' }, { scheduledAt: 'asc' }],
      include: {
        homeRoster: { select: { id: true, name: true, tag: true, logoUrl: true, userId: true } },
        awayRoster: { select: { id: true, name: true, tag: true, logoUrl: true, userId: true } },
        proofs: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            claimedHomeScore: true,
            claimedAwayScore: true,
            aiHomeScore: true,
            aiAwayScore: true,
            aiConfidence: true,
            aiAgrees: true,
            aiNotes: true,
            createdAt: true,
          },
        },
      },
    });
  }

  /// Artilharia da liga: gol primeiro, assistência como desempate, e só quem
  /// entrou em campo aparece.
  async scorers(leagueId: string) {
    return this.prisma.draftPlayer.findMany({
      where: { leagueId, OR: [{ goals: { gt: 0 } }, { assists: { gt: 0 } }] },
      orderBy: [{ goals: 'desc' }, { assists: 'desc' }, { name: 'asc' }],
      take: 60,
      select: {
        id: true,
        name: true,
        position: true,
        goals: true,
        assists: true,
        appearances: true,
        rating: true,
        photoUrl: true,
        roster: { select: { id: true, name: true, tag: true, logoUrl: true } },
      },
    });
  }

  /// Fecha a rodada sem ninguém lançar, que é o caso do time vago.
  async settleWalkover(matchId: string, homeScore: number, awayScore: number) {
    return this.settle(matchId, homeScore, awayScore, 'vaga');
  }

  async report(leagueId: string, matchId: string, dto: ReportDraftResultDto, actor: Actor) {
    const match = await this.prisma.draftMatch.findFirst({
      where: { id: matchId, leagueId },
      include: {
        league: true,
        homeRoster: { select: { id: true, name: true, userId: true } },
        awayRoster: { select: { id: true, name: true, userId: true } },
      },
    });
    if (!match) throw new NotFoundException('Rodada não encontrada.');
    if (match.status === DraftMatchStatus.FINISHED) {
      throw new BadRequestException('Esta partida já foi encerrada.');
    }

    const access = await this.access.of(leagueId, actor);
    const isPlayer = match.homeRoster.userId === actor.id || match.awayRoster.userId === actor.id;
    if (!access.canModerate && !isPlayer) {
      throw new ForbiddenException('Só quem joga a partida ou a organização pode lançar o resultado.');
    }

    const scorers = await this.checkScorers(match, dto);

    if (!dto.imageBase64) {
      if (!access.canModerate) {
        throw new BadRequestException('Envie a foto do placar para validar o resultado.');
      }
      const settled = await this.settle(matchId, dto.homeScore, dto.awayScore, actor.discordId, undefined, scorers);
      return { match: settled, proof: null, autoApproved: true };
    }

    const image = this.decodeImage(dto.imageBase64, dto.mimeType);
    const reading = await this.reader.read({
      imageBase64: dto.imageBase64,
      mimeType: image.mimeType,
      homeName: match.homeRoster.name,
      awayName: match.awayRoster.name,
      gameLabel: match.league.name,
    });

    const agrees =
      reading.homeScore === dto.homeScore && reading.awayScore === dto.awayScore && reading.homeScore !== null;

    const proof = await this.prisma.$transaction(async (tx) => {
      const created = await tx.matchProof.create({
        data: {
          draftMatchId: matchId,
          submittedByDiscordId: actor.discordId,
          image: image.buffer,
          mimeType: image.mimeType,
          imageSha256: createHash('sha256').update(image.buffer).digest('hex'),
          claimedHomeScore: dto.homeScore,
          claimedAwayScore: dto.awayScore,
          aiProvider: reading.provider,
          aiModel: reading.model,
          aiHomeScore: reading.homeScore,
          aiAwayScore: reading.awayScore,
          aiConfidence: reading.confidence,
          aiAgrees: reading.available ? agrees : null,
          aiNotes: reading.notes,
          aiRaw: reading.raw === null ? undefined : (reading.raw as object),
          processedAt: new Date(),
        },
      });
      await tx.draftMatch.update({
        where: { id: matchId },
        data: { status: DraftMatchStatus.AWAITING_PROOF, reportedByDiscordId: actor.discordId },
      });
      return created;
    });

    const autoApprove =
      access.canModerate || (reading.available && agrees && reading.confidence >= AUTO_APPROVE_MIN_CONFIDENCE);
    if (!autoApprove) return { match: null, proof, autoApproved: false };

    const settled = await this.approveProof(proof.id, actor.discordId, undefined, scorers);
    return { match: settled, proof, autoApproved: true };
  }

  async reviewProof(leagueId: string, proofId: string, approve: boolean, note: string | undefined, actor: Actor) {
    await this.access.requireModerate(leagueId, actor);
    const proof = await this.prisma.matchProof.findFirst({
      where: { id: proofId, draftMatch: { leagueId } },
    });
    if (!proof) throw new NotFoundException('Prova não encontrada.');
    if (proof.status !== MatchProofStatus.PENDING) {
      throw new BadRequestException('Esta prova já foi avaliada.');
    }

    if (approve) {
      const match = await this.approveProof(proofId, actor.discordId, note);
      return { approved: true, match };
    }

    await this.prisma.matchProof.update({
      where: { id: proofId },
      data: {
        status: MatchProofStatus.REJECTED,
        reviewedByDiscordId: actor.discordId,
        reviewedAt: new Date(),
        reviewNote: note ?? 'Prova recusada pela organização.',
      },
    });
    const match = await this.prisma.draftMatch.update({
      where: { id: proof.draftMatchId! },
      data: { status: DraftMatchStatus.SCHEDULED },
    });
    return { approved: false, match };
  }

  async pendingProofs(leagueId: string, actor: Actor) {
    await this.access.requireModerate(leagueId, actor);
    return this.prisma.matchProof.findMany({
      where: { status: MatchProofStatus.PENDING, draftMatch: { leagueId } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        claimedHomeScore: true,
        claimedAwayScore: true,
        aiHomeScore: true,
        aiAwayScore: true,
        aiConfidence: true,
        aiAgrees: true,
        aiNotes: true,
        submittedByDiscordId: true,
        createdAt: true,
        draftMatch: {
          select: {
            id: true,
            round: true,
            homeRoster: { select: { id: true, name: true, logoUrl: true } },
            awayRoster: { select: { id: true, name: true, logoUrl: true } },
          },
        },
      },
    });
  }

  async proofImage(proofId: string) {
    const proof = await this.prisma.matchProof.findUnique({
      where: { id: proofId },
      select: { image: true, mimeType: true },
    });
    if (!proof) throw new NotFoundException('Prova não encontrada.');
    return proof;
  }

  private async approveProof(
    proofId: string,
    reviewedByDiscordId: string,
    note?: string,
    scorers?: ScorerDto[],
  ) {
    const proof = await this.prisma.matchProof.update({
      where: { id: proofId },
      data: {
        status: MatchProofStatus.APPROVED,
        reviewedByDiscordId,
        reviewedAt: new Date(),
        reviewNote: note ?? 'Placar confirmado.',
      },
    });
    return this.settle(
      proof.draftMatchId!,
      proof.claimedHomeScore,
      proof.claimedAwayScore,
      proof.submittedByDiscordId,
      undefined,
      scorers,
    );
  }

  /// Fecha a partida com o resultado que o motor calculou. O caminho é o mesmo do
  /// placar lançado à mão, o que muda é que aqui cada jogador ganha nota, gol,
  /// assistência e forma em vez de só somar presença.
  async settleSimulated(matchId: string, result: SimulatedMatch) {
    return this.settle(matchId, result.homeScore, result.awayScore, 'simulacao', result.performances);
  }

  /// Confere os autores contra o placar e contra o elenco: gol de quem não jogava
  /// ali, ou soma diferente do placar, é erro de digitação e volta para quem
  /// lançou.
  private async checkScorers(
    match: { id: string; homeRosterId: string; awayRosterId: string },
    dto: ReportDraftResultDto,
  ): Promise<ScorerDto[] | undefined> {
    const scorers = (dto.scorers ?? []).filter((entry) => (entry.goals ?? 0) > 0 || (entry.assists ?? 0) > 0);
    if (scorers.length === 0) return undefined;

    const players = await this.prisma.draftPlayer.findMany({
      where: { id: { in: scorers.map((entry) => entry.playerId) } },
      select: { id: true, name: true, rosterId: true },
    });
    const byId = new Map(players.map((player) => [player.id, player]));

    let homeGoals = 0;
    let awayGoals = 0;
    for (const entry of scorers) {
      const player = byId.get(entry.playerId);
      if (!player) throw new BadRequestException('Algum jogador da lista de gols não existe.');
      if (player.rosterId === match.homeRosterId) homeGoals += entry.goals ?? 0;
      else if (player.rosterId === match.awayRosterId) awayGoals += entry.goals ?? 0;
      else throw new BadRequestException(`${player.name} não joga por nenhum dos dois elencos.`);
    }

    if (homeGoals > dto.homeScore || awayGoals > dto.awayScore) {
      throw new BadRequestException('A soma dos gols dos autores passou do placar informado.');
    }
    return scorers;
  }

  private async settle(
    matchId: string,
    homeScore: number,
    awayScore: number,
    reportedByDiscordId: string,
    performances?: PlayerPerformance[],
    scorers?: ScorerDto[],
  ) {
    const match = await this.prisma.draftMatch.findUniqueOrThrow({
      where: { id: matchId },
      include: { league: true, homeRoster: true, awayRoster: true },
    });

    return this.prisma.$transaction(
      async (tx) => {
        const updated = await tx.draftMatch.update({
          where: { id: matchId },
          data: {
            homeScore,
            awayScore,
            status: DraftMatchStatus.FINISHED,
            playedAt: new Date(),
            reportedByDiscordId,
          },
        });

        await this.applyRosterStats(tx, match.league, match.homeRosterId, homeScore, awayScore);
        await this.applyRosterStats(tx, match.league, match.awayRosterId, awayScore, homeScore);
        await this.creditRound(tx, match.league, match.homeRosterId, homeScore, awayScore, match.round);
        await this.creditRound(tx, match.league, match.awayRosterId, awayScore, homeScore, match.round);
        await this.paySalaries(tx, match.league, match.homeRosterId, match.round);
        await this.paySalaries(tx, match.league, match.awayRosterId, match.round);
        if (performances) await this.applyPerformances(tx, performances);
        else {
          await this.bumpAppearances(tx, match.homeRosterId, match.awayRosterId);
          await this.applyScorers(tx, scorers);
        }
        await this.advanceRound(tx, match.league.id);

        return updated;
      },
      { timeout: 30000 },
    );
  }

  private async applyRosterStats(
    tx: Prisma.TransactionClient,
    league: DraftLeague,
    rosterId: string,
    scored: number,
    conceded: number,
  ) {
    const isWin = scored > conceded;
    const isDraw = scored === conceded;
    await tx.draftRoster.update({
      where: { id: rosterId },
      data: {
        played: { increment: 1 },
        wins: { increment: isWin ? 1 : 0 },
        draws: { increment: isDraw ? 1 : 0 },
        losses: { increment: !isWin && !isDraw ? 1 : 0 },
        goalsFor: { increment: scored },
        goalsAgainst: { increment: conceded },
        points: { increment: isWin ? league.pointsWin : isDraw ? league.pointsDraw : 0 },
      },
    });
  }

  /// Premiação da rodada cai no caixa da liga, não na carteira da conta.
  private async creditRound(
    tx: Prisma.TransactionClient,
    league: DraftLeague,
    rosterId: string,
    scored: number,
    conceded: number,
    round: number,
  ) {
    const amount = scored > conceded ? league.coinsWin : scored === conceded ? league.coinsDraw : league.coinsLoss;
    const label = scored > conceded ? 'Vitória' : scored === conceded ? 'Empate' : 'Derrota';
    await this.budget.credit(
      {
        leagueId: league.id,
        rosterId,
        amount,
        type: DraftBudgetTxType.MATCH_REWARD,
        description: `${label} na rodada ${round}`,
        round,
      },
      tx,
    );
  }

  /// Folha salarial da rodada. É obrigação: passa mesmo sem caixa e deixa o
  /// elenco no vermelho, o que trava contratação até ele se recuperar.
  private async paySalaries(
    tx: Prisma.TransactionClient,
    league: DraftLeague,
    rosterId: string,
    round: number,
  ) {
    if (!league.paySalaries) return;
    const wages = await tx.draftPlayer.aggregate({ where: { rosterId }, _sum: { salary: true } });
    await this.budget.charge(
      {
        leagueId: league.id,
        rosterId,
        amount: wages._sum.salary ?? 0,
        type: DraftBudgetTxType.SALARY,
        description: `Folha salarial da rodada ${round}`,
        round,
      },
      tx,
    );
  }

  /// Nota da partida virando história do jogador: média, forma e, de vez em
  /// quando, um ponto de atributo para cima ou para baixo.
  private async applyPerformances(tx: Prisma.TransactionClient, performances: PlayerPerformance[]) {
    const now = new Date();

    for (const performance of performances) {
      const player = await tx.draftPlayer.findUnique({ where: { id: performance.playerId } });
      if (!player) continue;

      const ratingAvg = nextRatingAvg(player.rating, player.appearances, performance.rating);
      const change = attributeChange(
        {
          position: player.position,
          birthDate: player.birthDate,
          form: player.form,
          ratingAvg,
          matchesPlayed: player.appearances + 1,
          attributes: player,
        },
        (performance.rating * 137) % 1,
        now,
      );
      const attributes = change ? applyChange(player, change) : null;

      await tx.draftPlayer.update({
        where: { id: player.id },
        data: {
          appearances: { increment: 1 },
          goals: { increment: performance.goals },
          assists: { increment: performance.assists },
          rating: ratingAvg,
          lastRating: performance.rating,
          form: nextForm(player.form, performance.rating),
          ...(attributes ? { ...attributes, overall: overallFromAttributes(player.position, attributes) } : {}),
        },
      });
    }
  }

  private async applyScorers(tx: Prisma.TransactionClient, scorers?: ScorerDto[]) {
    for (const entry of scorers ?? []) {
      await tx.draftPlayer.update({
        where: { id: entry.playerId },
        data: {
          goals: { increment: entry.goals ?? 0 },
          assists: { increment: entry.assists ?? 0 },
        },
      });
    }
  }

  private async bumpAppearances(tx: Prisma.TransactionClient, homeRosterId: string, awayRosterId: string) {
    await tx.draftPlayer.updateMany({
      where: { rosterId: { in: [homeRosterId, awayRosterId] }, starter: true },
      data: { appearances: { increment: 1 } },
    });
  }

  private async advanceRound(tx: Prisma.TransactionClient, leagueId: string) {
    const nextOpen = await tx.draftMatch.findFirst({
      where: { leagueId, status: { not: DraftMatchStatus.FINISHED } },
      orderBy: { round: 'asc' },
      select: { round: true },
    });
    await tx.draftLeague.update({
      where: { id: leagueId },
      data: nextOpen
        ? { currentRound: nextOpen.round }
        : { status: 'FINISHED', finishedAt: new Date() },
    });
  }

  private decodeImage(imageBase64: string, mimeType?: string) {
    const resolved = (mimeType ?? 'image/jpeg').toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(resolved)) {
      throw new BadRequestException('Formato de imagem não suportado. Use JPEG, PNG ou WebP.');
    }
    const payload = imageBase64.includes(',') ? imageBase64.slice(imageBase64.indexOf(',') + 1) : imageBase64;
    const buffer = Buffer.from(payload, 'base64');
    if (buffer.length === 0) throw new BadRequestException('Imagem inválida.');
    if (buffer.length > MAX_IMAGE_BYTES) throw new BadRequestException('A imagem precisa ter no máximo 3MB.');
    return { buffer, mimeType: resolved };
  }
}
