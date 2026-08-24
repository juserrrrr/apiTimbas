import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MatchProof, MatchProofStatus, Prisma, TournamentMatchStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { Actor } from '../common/actor.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScoreReaderService } from '../score-reader/score-reader.service';
import { FEATURE_TOURNAMENT_AI_RESULTS } from '../feature-flags/feature-flags.constants';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { ReportResultDto, ReviewProofDto } from './dto/tournament.dto';
import { TournamentAccessService } from './tournament-access.service';
import { TournamentResultService } from './tournament-result.service';

const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 3 * 1024 * 1024;
const OPEN: TournamentMatchStatus[] = [TournamentMatchStatus.READY, TournamentMatchStatus.AWAITING_PROOF, TournamentMatchStatus.DISPUTED];

@Injectable()
export class MatchProofService {
  private readonly logger = new Logger(MatchProofService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TournamentAccessService,
    private readonly reader: ScoreReaderService,
    private readonly results: TournamentResultService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  async report(tournamentId: string, matchId: string, dto: ReportResultDto, actor: Actor) {
    if (!(await this.featureFlags.isEnabled(FEATURE_TOURNAMENT_AI_RESULTS))) {
      throw new BadRequestException('O envio por imagem só fica disponível quando a IA está ativada.');
    }
    if (!dto.imageBase64) throw new BadRequestException('Envie uma imagem do placar para análise.');
    const match = await this.prisma.tournamentMatch.findFirst({
      where: { id: matchId, tournamentId },
      include: { tournament: true, homeTeam: true, awayTeam: true },
    });
    if (!match) throw new NotFoundException('Partida não encontrada.');
    const access = await this.access.of(tournamentId, actor);
    const participant = access.teamIds.includes(match.homeTeamId ?? '') || access.teamIds.includes(match.awayTeamId ?? '');
    if (!access.canModerate && !participant) throw new ForbiddenException('Só quem joga ou a organização pode lançar o resultado.');
    if (!OPEN.includes(match.status)) throw new BadRequestException('Esta partida já foi encerrada.');
    this.results.assertScoreIsValid(match, match.tournament, dto.homeScore, dto.awayScore);

    const image = this.decodeImage(dto.imageBase64, dto.mimeType);
    const imageSha256 = createHash('sha256').update(image.buffer).digest('hex');
    if (await this.prisma.matchProof.findUnique({ where: { imageSha256 } })) throw new BadRequestException('Esta imagem já foi usada como prova.');
    if (await this.prisma.matchProof.findFirst({ where: { matchId, status: MatchProofStatus.PENDING } })) {
      throw new BadRequestException('Esta partida já tem uma prova em análise ou revisão.');
    }

    let proof: MatchProof;
    try {
      proof = await this.prisma.$transaction(async (tx) => {
        const created = await tx.matchProof.create({
          data: {
            matchId, submittedByDiscordId: actor.discordId, image: image.buffer, mimeType: image.mimeType,
            imageSha256, claimedHomeScore: dto.homeScore, claimedAwayScore: dto.awayScore,
          },
        });
        await tx.tournamentMatch.update({
          where: { id: matchId },
          data: { status: TournamentMatchStatus.AWAITING_PROOF, reportedByDiscordId: actor.discordId },
        });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Esta imagem já foi usada ou a partida já tem uma prova pendente.');
      }
      throw error;
    }
    void this.processProof(proof.id);
    return { match: null, proof: this.publicProof(proof), autoApproved: false, processing: true };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processQueuedProofs() {
    const queued = await this.prisma.matchProof.findMany({
      where: {
        status: MatchProofStatus.PENDING, processedAt: null, processingAttempts: { lt: 3 },
        OR: [{ processingAt: null }, { processingAt: { lt: new Date(Date.now() - 5 * 60_000) } }],
      },
      select: { id: true }, take: 10, orderBy: { createdAt: 'asc' },
    });
    await Promise.all(queued.map(({ id }) => this.processProof(id)));
  }

  private async processProof(id: string) {
    if (!(await this.featureFlags.isEnabled(FEATURE_TOURNAMENT_AI_RESULTS))) {
      await this.prisma.matchProof.updateMany({
        where: { id, status: MatchProofStatus.PENDING, processedAt: null },
        data: { processedAt: new Date(), processingAt: null, aiNotes: 'Leitura por IA desativada. A organização precisa revisar a prova.' },
      });
      return;
    }
    const lock = await this.prisma.matchProof.updateMany({
      where: {
        id, status: MatchProofStatus.PENDING, processedAt: null,
        OR: [{ processingAt: null }, { processingAt: { lt: new Date(Date.now() - 5 * 60_000) } }],
      },
      data: { processingAt: new Date(), processingAttempts: { increment: 1 } },
    });
    if (!lock.count) return;
    const proof = await this.prisma.matchProof.findUnique({
      where: { id }, include: { match: { include: { tournament: true, homeTeam: true, awayTeam: true } } },
    });
    if (!proof?.match) return;
    try {
      const reading = await this.reader.read({
        imageBase64: Buffer.from(proof.image).toString('base64'), mimeType: proof.mimeType,
        homeName: proof.match.homeTeam?.name ?? 'Mandante', awayName: proof.match.awayTeam?.name ?? 'Visitante',
        gameLabel: proof.match.tournament.gameLabel ?? proof.match.tournament.game,
      });
      const agrees = reading.homeScore === proof.claimedHomeScore && reading.awayScore === proof.claimedAwayScore;
      await this.prisma.matchProof.update({
        where: { id }, data: {
          aiProvider: reading.provider, aiModel: reading.model, aiHomeScore: reading.homeScore,
          aiAwayScore: reading.awayScore, aiConfidence: reading.confidence,
          aiAgrees: reading.available ? agrees : null, aiNotes: reading.notes,
          aiRaw: reading.raw === null ? undefined : (reading.raw as object), processedAt: new Date(), processingAt: null,
        },
      });
      const tournament = proof.match.tournament;
      if (tournament.autoApproveProof && reading.available && agrees && reading.confidence >= tournament.autoApproveMinConfidence) {
        await this.approve(id, 'auto', `Leitura automática confirmou o placar (${reading.confidence}%).`);
      }
    } catch (error) {
      const exhausted = proof.processingAttempts >= 3;
      await this.prisma.matchProof.update({
        where: { id },
        data: {
          processingAt: null,
          ...(exhausted ? {
            processedAt: new Date(),
            aiNotes: 'A leitura automática falhou após três tentativas. A organização precisa revisar a prova.',
          } : {}),
        },
      });
      this.logger.warn(`Falha ao processar a prova ${id}: ${(error as Error).message}`);
    }
  }

  async review(tournamentId: string, proofId: string, dto: ReviewProofDto, actor: Actor) {
    await this.access.requireModerate(tournamentId, actor);
    const proof = await this.prisma.matchProof.findFirst({ where: { id: proofId, match: { tournamentId } } });
    if (!proof) throw new NotFoundException('Prova não encontrada.');
    if (proof.status !== MatchProofStatus.PENDING) throw new BadRequestException('Esta prova já foi avaliada.');
    if (!proof.processedAt) throw new BadRequestException('A prova ainda está sendo analisada.');
    if (dto.approve) return { approved: true, match: await this.approve(proofId, actor.discordId, dto.note ?? 'Aprovado pela organização.') };
    await this.prisma.matchProof.update({
      where: { id: proofId }, data: {
        status: MatchProofStatus.REJECTED, reviewedByDiscordId: actor.discordId,
        reviewedAt: new Date(), reviewNote: dto.note ?? 'Prova recusada pela organização.',
      },
    });
    return { approved: false, match: await this.results.reopen(proof.matchId!) };
  }

  async image(tournamentId: string, proofId: string, actor: Actor) {
    const access = await this.access.of(tournamentId, actor);
    const proof = await this.prisma.matchProof.findFirst({
      where: { id: proofId, match: { tournamentId } },
      select: { image: true, mimeType: true, match: { select: { homeTeamId: true, awayTeamId: true } } },
    });
    if (!proof) throw new NotFoundException('Prova não encontrada.');
    const participant = access.teamIds.some((teamId) => teamId === proof.match?.homeTeamId || teamId === proof.match?.awayTeamId);
    if (!access.canModerate && !participant) throw new ForbiddenException('Você não pode ver esta prova.');
    return proof;
  }

  async pending(tournamentId: string, actor: Actor) {
    await this.access.requireModerate(tournamentId, actor);
    const proofs = await this.prisma.matchProof.findMany({
      where: { status: MatchProofStatus.PENDING, processedAt: { not: null }, match: { tournamentId } },
      orderBy: { createdAt: 'asc' },
      include: { match: { select: {
        id: true, label: true, round: true, phase: true,
        homeTeam: { select: { id: true, name: true, logoUrl: true } },
        awayTeam: { select: { id: true, name: true, logoUrl: true } },
      } } },
    });
    return proofs.map((proof) => ({ ...this.publicProof(proof), match: proof.match }));
  }

  private async approve(id: string, reviewedByDiscordId: string, reviewNote: string) {
    const proof = await this.prisma.matchProof.update({
      where: { id }, data: { status: MatchProofStatus.APPROVED, reviewedByDiscordId, reviewedAt: new Date(), reviewNote },
    });
    return this.results.settle(proof.matchId!, proof.claimedHomeScore, proof.claimedAwayScore, proof.submittedByDiscordId);
  }

  private decodeImage(value: string, mimeType?: string) {
    const resolved = (mimeType ?? 'image/jpeg').toLowerCase();
    if (!MIME_TYPES.includes(resolved)) throw new BadRequestException('Formato não suportado. Use JPEG, PNG ou WebP.');
    const payload = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
    const buffer = Buffer.from(payload, 'base64');
    if (!buffer.length) throw new BadRequestException('Imagem inválida.');
    if (buffer.length > MAX_BYTES) throw new BadRequestException('A imagem precisa ter no máximo 3MB.');
    const valid =
      (resolved === 'image/jpeg' && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
      (resolved === 'image/png' && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
      (resolved === 'image/webp' && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP');
    if (!valid) throw new BadRequestException('O conteúdo do arquivo não corresponde ao formato informado.');
    return { buffer, mimeType: resolved };
  }

  private publicProof(proof: {
    id: string; status: MatchProofStatus; claimedHomeScore: number; claimedAwayScore: number;
    aiHomeScore: number | null; aiAwayScore: number | null; aiConfidence: number | null; aiAgrees: boolean | null;
    aiNotes: string | null; aiProvider: string | null; aiModel: string | null; submittedByDiscordId: string;
    reviewNote: string | null; processedAt: Date | null; createdAt: Date;
  }) {
    return {
      id: proof.id, status: proof.status, claimedHomeScore: proof.claimedHomeScore, claimedAwayScore: proof.claimedAwayScore,
      aiHomeScore: proof.aiHomeScore, aiAwayScore: proof.aiAwayScore, aiConfidence: proof.aiConfidence,
      aiAgrees: proof.aiAgrees, aiNotes: proof.aiNotes, aiProvider: proof.aiProvider, aiModel: proof.aiModel,
      submittedByDiscordId: proof.submittedByDiscordId, reviewNote: proof.reviewNote,
      processing: proof.processedAt === null, createdAt: proof.createdAt,
    };
  }
}
