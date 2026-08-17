import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MatchProofStatus, TournamentMatchStatus } from '@prisma/client';
import { Actor } from '../common/actor.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScoreReaderService } from '../score-reader/score-reader.service';
import { ReportResultDto, ReviewProofDto } from './dto/tournament.dto';
import { TournamentAccessService } from './tournament-access.service';
import { TournamentResultService } from './tournament-result.service';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

@Injectable()
export class MatchProofService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TournamentAccessService,
    private readonly reader: ScoreReaderService,
    private readonly results: TournamentResultService,
  ) {}

  async report(tournamentId: string, matchId: string, dto: ReportResultDto, actor: Actor) {
    const match = await this.prisma.tournamentMatch.findFirst({
      where: { id: matchId, tournamentId },
      include: {
        tournament: true,
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
      },
    });
    if (!match) throw new NotFoundException('Partida não encontrada.');

    const access = await this.access.of(tournamentId, actor);
    const isParticipant =
      access.teamIds.includes(match.homeTeamId ?? '') || access.teamIds.includes(match.awayTeamId ?? '');
    if (!access.canModerate && !isParticipant) {
      throw new ForbiddenException('Só quem joga a partida ou a organização pode lançar o resultado.');
    }
    this.results.assertScoreIsValid(match, match.tournament, dto.homeScore, dto.awayScore);

    if (!dto.imageBase64) {
      if (match.tournament.requireProof && !access.canModerate) {
        throw new BadRequestException('Este campeonato exige a foto do placar para validar o resultado.');
      }
      const settled = await this.results.settle(matchId, dto.homeScore, dto.awayScore, actor.discordId);
      return { match: settled, proof: null, autoApproved: true };
    }

    const image = this.decodeImage(dto.imageBase64, dto.mimeType);
    const reading = await this.reader.read({
      imageBase64: dto.imageBase64,
      mimeType: image.mimeType,
      homeName: match.homeTeam?.name ?? 'Mandante',
      awayName: match.awayTeam?.name ?? 'Visitante',
      gameLabel: match.tournament.gameLabel ?? match.tournament.game,
    });

    const agrees =
      reading.homeScore !== null &&
      reading.awayScore !== null &&
      reading.homeScore === dto.homeScore &&
      reading.awayScore === dto.awayScore;

    const proof = await this.prisma.$transaction(async (tx) => {
      const created = await tx.matchProof.create({
        data: {
          matchId,
          submittedByDiscordId: actor.discordId,
          image: image.buffer,
          mimeType: image.mimeType,
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
        },
      });
      await tx.tournamentMatch.update({
        where: { id: matchId },
        data: { status: TournamentMatchStatus.AWAITING_PROOF, reportedByDiscordId: actor.discordId },
      });
      return created;
    });

    const autoApprove =
      access.canModerate ||
      (match.tournament.autoApproveProof &&
        reading.available &&
        agrees &&
        reading.confidence >= match.tournament.autoApproveMinConfidence);

    if (!autoApprove) {
      return { match: null, proof: this.publicProof(proof), autoApproved: false };
    }

    const settled = await this.approve(
      proof.id,
      access.canModerate ? actor.discordId : 'auto',
      access.canModerate ? 'Aprovado pela organização.' : `Leitura automática confirmou o placar (${reading.confidence}%).`,
    );
    return { match: settled, proof: this.publicProof({ ...proof, status: MatchProofStatus.APPROVED }), autoApproved: true };
  }

  async review(tournamentId: string, proofId: string, dto: ReviewProofDto, actor: Actor) {
    await this.access.requireModerate(tournamentId, actor);
    const proof = await this.prisma.matchProof.findFirst({
      where: { id: proofId, match: { tournamentId } },
    });
    if (!proof) throw new NotFoundException('Prova não encontrada.');
    if (proof.status !== MatchProofStatus.PENDING) {
      throw new BadRequestException('Esta prova já foi avaliada.');
    }

    if (dto.approve) {
      const match = await this.approve(proofId, actor.discordId, dto.note ?? 'Aprovado pela organização.');
      return { approved: true, match };
    }

    await this.prisma.matchProof.update({
      where: { id: proofId },
      data: {
        status: MatchProofStatus.REJECTED,
        reviewedByDiscordId: actor.discordId,
        reviewedAt: new Date(),
        reviewNote: dto.note ?? 'Prova recusada pela organização.',
      },
    });
    const match = await this.results.reopen(proof.matchId!);
    return { approved: false, match };
  }

  async image(proofId: string) {
    const proof = await this.prisma.matchProof.findUnique({
      where: { id: proofId },
      select: { image: true, mimeType: true },
    });
    if (!proof) throw new NotFoundException('Prova não encontrada.');
    return proof;
  }

  async pending(tournamentId: string, actor: Actor) {
    await this.access.requireModerate(tournamentId, actor);
    const proofs = await this.prisma.matchProof.findMany({
      where: { status: MatchProofStatus.PENDING, match: { tournamentId } },
      orderBy: { createdAt: 'asc' },
      include: {
        match: {
          select: {
            id: true,
            label: true,
            round: true,
            phase: true,
            homeTeam: { select: { id: true, name: true, logoUrl: true } },
            awayTeam: { select: { id: true, name: true, logoUrl: true } },
          },
        },
      },
    });
    return proofs.map((proof) => ({ ...this.publicProof(proof), match: proof.match }));
  }

  private async approve(proofId: string, reviewedByDiscordId: string, note: string) {
    const proof = await this.prisma.matchProof.update({
      where: { id: proofId },
      data: {
        status: MatchProofStatus.APPROVED,
        reviewedByDiscordId,
        reviewedAt: new Date(),
        reviewNote: note,
      },
    });
    return this.results.settle(
      proof.matchId!,
      proof.claimedHomeScore,
      proof.claimedAwayScore,
      proof.submittedByDiscordId,
    );
  }

  private decodeImage(imageBase64: string, mimeType?: string) {
    const resolved = (mimeType ?? 'image/jpeg').toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(resolved)) {
      throw new BadRequestException('Formato de imagem não suportado. Use JPEG, PNG ou WebP.');
    }

    const payload = imageBase64.includes(',') ? imageBase64.slice(imageBase64.indexOf(',') + 1) : imageBase64;
    const buffer = Buffer.from(payload, 'base64');
    if (buffer.length === 0) throw new BadRequestException('Imagem inválida.');
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException('A imagem precisa ter no máximo 3MB.');
    }
    return { buffer, mimeType: resolved };
  }

  private publicProof(proof: {
    id: string;
    status: MatchProofStatus;
    claimedHomeScore: number;
    claimedAwayScore: number;
    aiHomeScore: number | null;
    aiAwayScore: number | null;
    aiConfidence: number | null;
    aiAgrees: boolean | null;
    aiNotes: string | null;
    aiProvider: string | null;
    aiModel: string | null;
    submittedByDiscordId: string;
    reviewNote: string | null;
    createdAt: Date;
  }) {
    return {
      id: proof.id,
      status: proof.status,
      claimedHomeScore: proof.claimedHomeScore,
      claimedAwayScore: proof.claimedAwayScore,
      aiHomeScore: proof.aiHomeScore,
      aiAwayScore: proof.aiAwayScore,
      aiConfidence: proof.aiConfidence,
      aiAgrees: proof.aiAgrees,
      aiNotes: proof.aiNotes,
      aiProvider: proof.aiProvider,
      aiModel: proof.aiModel,
      submittedByDiscordId: proof.submittedByDiscordId,
      reviewNote: proof.reviewNote,
      createdAt: proof.createdAt,
    };
  }
}
