import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, TournamentMatch, TournamentMatchStatus } from '@prisma/client';
import { Actor } from '../common/actor.service';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentAccessService } from './tournament-access.service';
import { TournamentResultService } from './tournament-result.service';
import { ClaimResultDto, MatchMessageDto, ProposeScheduleDto, RespondClaimDto, RespondScheduleDto } from './dto/tournament.dto';

const OPEN_STATUSES: TournamentMatchStatus[] = [
  TournamentMatchStatus.READY,
  TournamentMatchStatus.AWAITING_PROOF,
  TournamentMatchStatus.DISPUTED,
];

/// Tudo que os dois times resolvem entre si numa partida: conversar, combinar
/// horário, informar placar e confirmar o do outro. A organização entra só quando
/// eles não se entendem, ou quando o prazo estoura e sai W.O.
@Injectable()
export class TournamentMatchService {
  private readonly logger = new Logger(TournamentMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TournamentAccessService,
    private readonly results: TournamentResultService,
  ) {}

  async view(tournamentId: string, matchId: string, actor: Actor) {
    const match = await this.requireMatch(tournamentId, matchId);
    const access = await this.access.of(tournamentId, actor);
    const side = this.sideOf(match, access.teamIds);
    if (!side && !access.canModerate) {
      throw new ForbiddenException('Só quem joga a partida ou a organização vê esta conversa.');
    }

    const [messages, tournament] = await Promise.all([
      this.prisma.tournamentMatchMessage.findMany({
        where: { matchId },
        orderBy: { createdAt: 'asc' },
        take: 200,
        include: { user: { select: { id: true, name: true, avatar: true } } },
      }),
      this.access.requireExists(tournamentId),
    ]);

    return {
      match,
      messages,
      mySide: side,
      canModerate: access.canModerate,
      deadlineAt: this.deadlineOf(match, tournament.woAfterHours),
      requireOpponentConfirm: tournament.requireOpponentConfirm,
    };
  }

  async postMessage(tournamentId: string, matchId: string, dto: MatchMessageDto, actor: Actor) {
    const match = await this.requireMatch(tournamentId, matchId);
    const { side, canModerate } = await this.requireParticipant(tournamentId, match, actor);

    return this.prisma.tournamentMatchMessage.create({
      data: {
        matchId,
        userId: actor.id,
        teamId: side ? (side === 'HOME' ? match.homeTeamId : match.awayTeamId) : null,
        body: dto.body,
        system: false,
      },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
  }

  /// Proposta de horário: um time propõe, o outro aceita. Aceitar marca a partida,
  /// e a conversa guarda o combinado.
  async proposeSchedule(tournamentId: string, matchId: string, dto: ProposeScheduleDto, actor: Actor) {
    const match = await this.requireMatch(tournamentId, matchId);
    const { side } = await this.requireParticipant(tournamentId, match, actor);
    if (!side) throw new ForbiddenException('Só quem joga a partida propõe horário.');
    this.assertOpen(match);
    if (dto.scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException('Proponha um horário no futuro.');
    }

    const teamId = side === 'HOME' ? match.homeTeamId! : match.awayTeamId!;
    const updated = await this.prisma.tournamentMatch.update({
      where: { id: matchId },
      data: { scheduleProposedAt: dto.scheduledAt, scheduleProposedByTeamId: teamId },
    });
    await this.systemMessage(matchId, teamId, `Propôs jogar em ${this.when(dto.scheduledAt)}.`);
    return updated;
  }

  async respondSchedule(tournamentId: string, matchId: string, dto: RespondScheduleDto, actor: Actor) {
    const match = await this.requireMatch(tournamentId, matchId);
    const { side } = await this.requireParticipant(tournamentId, match, actor);
    if (!side) throw new ForbiddenException('Só quem joga a partida responde à proposta.');
    if (!match.scheduleProposedAt) throw new BadRequestException('Não tem proposta de horário aberta.');

    const teamId = side === 'HOME' ? match.homeTeamId! : match.awayTeamId!;
    if (match.scheduleProposedByTeamId === teamId) {
      throw new BadRequestException('Quem propôs não pode responder à própria proposta.');
    }

    if (!dto.accept) {
      await this.systemMessage(matchId, teamId, 'Recusou o horário proposto.');
      return this.prisma.tournamentMatch.update({
        where: { id: matchId },
        data: { scheduleProposedAt: null, scheduleProposedByTeamId: null },
      });
    }

    const updated = await this.prisma.tournamentMatch.update({
      where: { id: matchId },
      data: { scheduledAt: match.scheduleProposedAt, scheduleProposedAt: null, scheduleProposedByTeamId: null },
    });
    await this.systemMessage(matchId, teamId, `Aceitou jogar em ${this.when(match.scheduleProposedAt)}.`);
    return updated;
  }

  /// Placar informado por um time, sem foto. Se o campeonato exige confirmação, ele
  /// fica esperando o adversário; senão fecha na hora.
  async claimResult(tournamentId: string, matchId: string, dto: ClaimResultDto, actor: Actor) {
    const tournament = await this.access.requireExists(tournamentId);
    const match = await this.requireMatch(tournamentId, matchId);
    const { side } = await this.requireParticipant(tournamentId, match, actor);
    if (!side) throw new ForbiddenException('Só quem joga a partida informa o placar.');
    this.assertOpen(match);
    this.results.assertScoreIsValid(match, tournament, dto.homeScore, dto.awayScore);

    const teamId = side === 'HOME' ? match.homeTeamId! : match.awayTeamId!;

    if (!tournament.requireOpponentConfirm) {
      await this.systemMessage(matchId, teamId, `Informou ${dto.homeScore} a ${dto.awayScore}.`);
      return this.results.settle(matchId, dto.homeScore, dto.awayScore, actor.discordId);
    }

    const updated = await this.prisma.tournamentMatch.update({
      where: { id: matchId },
      data: {
        claimedHomeScore: dto.homeScore,
        claimedAwayScore: dto.awayScore,
        claimedByTeamId: teamId,
        claimedAt: new Date(),
        status: TournamentMatchStatus.AWAITING_PROOF,
      },
    });
    await this.systemMessage(
      matchId,
      teamId,
      `Informou ${dto.homeScore} a ${dto.awayScore} e aguarda a confirmação do adversário.`,
    );
    return updated;
  }

  async respondClaim(tournamentId: string, matchId: string, dto: RespondClaimDto, actor: Actor) {
    const match = await this.requireMatch(tournamentId, matchId);
    const { side } = await this.requireParticipant(tournamentId, match, actor);
    if (!side) throw new ForbiddenException('Só quem joga a partida confirma o placar.');
    if (match.claimedHomeScore === null || match.claimedAwayScore === null) {
      throw new BadRequestException('Não tem placar informado para confirmar.');
    }

    const teamId = side === 'HOME' ? match.homeTeamId! : match.awayTeamId!;
    if (match.claimedByTeamId === teamId) {
      throw new BadRequestException('Quem informou o placar não pode confirmar sozinho.');
    }

    if (!dto.agree) {
      await this.systemMessage(matchId, teamId, 'Contestou o placar informado. A organização vai decidir.');
      return this.prisma.tournamentMatch.update({
        where: { id: matchId },
        data: { status: TournamentMatchStatus.DISPUTED },
      });
    }

    await this.systemMessage(matchId, teamId, 'Confirmou o placar informado.');
    return this.results.settle(matchId, match.claimedHomeScore, match.claimedAwayScore, actor.discordId);
  }

  /// Prazo estourado sem resultado. Quem se mexeu na partida leva a vaga; se
  /// ninguém se mexeu, passa o cabeça de chave, porque a chave precisa andar. Se os
  /// dois tentaram, é decisão humana e a partida vai para disputa.
  @Cron(CronExpression.EVERY_HOUR)
  async resolveDeadlines() {
    const tournaments = await this.prisma.tournament.findMany({
      where: { status: 'RUNNING', woAfterHours: { gt: 0 } },
      select: { id: true, name: true, woAfterHours: true },
    });

    for (const tournament of tournaments) {
      const limit = new Date(Date.now() - tournament.woAfterHours * 60 * 60 * 1000);
      const late = await this.prisma.tournamentMatch.findMany({
        where: {
          tournamentId: tournament.id,
          status: { in: [TournamentMatchStatus.READY, TournamentMatchStatus.AWAITING_PROOF] },
          readyAt: { not: null, lte: limit },
          homeTeamId: { not: null },
          awayTeamId: { not: null },
        },
        include: {
          homeTeam: { select: { id: true, name: true, seed: true } },
          awayTeam: { select: { id: true, name: true, seed: true } },
        },
        take: 40,
      });

      for (const match of late) {
        try {
          await this.applyDeadline(match, tournament.name);
        } catch (error) {
          this.logger.warn(`Falha no prazo da partida ${match.id}: ${(error as Error).message}`);
        }
      }
    }
  }

  private async applyDeadline(
    match: TournamentMatch & {
      homeTeam: { id: string; name: string; seed: number | null } | null;
      awayTeam: { id: string; name: string; seed: number | null } | null;
    },
    tournamentName: string,
  ) {
    const engaged = await this.engagedTeams(match);
    const homeEngaged = engaged.has(match.homeTeamId!);
    const awayEngaged = engaged.has(match.awayTeamId!);

    if (homeEngaged && awayEngaged) {
      await this.systemMessage(match.id, null, 'Prazo estourado com os dois times ativos. A organização vai decidir.');
      await this.prisma.tournamentMatch.update({
        where: { id: match.id },
        data: { status: TournamentMatchStatus.DISPUTED },
      });
      return;
    }

    const winner =
      homeEngaged || awayEngaged
        ? homeEngaged
          ? match.homeTeam!
          : match.awayTeam!
        : (match.homeTeam!.seed ?? 99) <= (match.awayTeam!.seed ?? 99)
          ? match.homeTeam!
          : match.awayTeam!;

    const reason = homeEngaged || awayEngaged ? 'adversário não respondeu no prazo' : 'nenhum time apareceu no prazo';
    await this.systemMessage(match.id, winner.id, `W.O. para ${winner.name}: ${reason}.`);
    await this.results.walkover(match.tournamentId, match.id, winner.id, reason, 'prazo');
    this.logger.log(`${tournamentName}: W.O. para ${winner.name} (${reason}).`);
  }

  /// Time "ativo" é o que fez algo pela partida: propôs horário, informou placar ou
  /// falou no chat.
  private async engagedTeams(match: TournamentMatch): Promise<Set<string>> {
    const engaged = new Set<string>();
    if (match.scheduleProposedByTeamId) engaged.add(match.scheduleProposedByTeamId);
    if (match.claimedByTeamId) engaged.add(match.claimedByTeamId);
    if (match.scheduledAt) {
      engaged.add(match.homeTeamId!);
      engaged.add(match.awayTeamId!);
    }

    const talked = await this.prisma.tournamentMatchMessage.findMany({
      where: { matchId: match.id, system: false, teamId: { not: null } },
      select: { teamId: true },
      distinct: ['teamId'],
    });
    for (const message of talked) engaged.add(message.teamId!);
    return engaged;
  }

  private deadlineOf(match: TournamentMatch, woAfterHours: number): Date | null {
    if (woAfterHours <= 0 || !match.readyAt) return null;
    if (!OPEN_STATUSES.includes(match.status)) return null;
    return new Date(match.readyAt.getTime() + woAfterHours * 60 * 60 * 1000);
  }

  private sideOf(match: TournamentMatch, teamIds: string[]): 'HOME' | 'AWAY' | null {
    if (match.homeTeamId && teamIds.includes(match.homeTeamId)) return 'HOME';
    if (match.awayTeamId && teamIds.includes(match.awayTeamId)) return 'AWAY';
    return null;
  }

  private async requireParticipant(tournamentId: string, match: TournamentMatch, actor: Actor) {
    const access = await this.access.of(tournamentId, actor);
    const side = this.sideOf(match, access.teamIds);
    if (!side && !access.canModerate) {
      throw new ForbiddenException('Só quem joga a partida ou a organização participa daqui.');
    }
    return { side, canModerate: access.canModerate };
  }

  private assertOpen(match: TournamentMatch) {
    if (!match.homeTeamId || !match.awayTeamId) {
      throw new BadRequestException('A partida ainda não tem os dois times definidos.');
    }
    if (!OPEN_STATUSES.includes(match.status)) {
      throw new BadRequestException('Esta partida já foi encerrada.');
    }
  }

  private async requireMatch(tournamentId: string, matchId: string) {
    const match = await this.prisma.tournamentMatch.findFirst({ where: { id: matchId, tournamentId } });
    if (!match) throw new NotFoundException('Partida não encontrada neste campeonato.');
    return match;
  }

  private systemMessage(matchId: string, teamId: string | null, body: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    return db.tournamentMatchMessage.create({ data: { matchId, teamId, body, system: true } });
  }

  private when(date: Date | null): string {
    if (!date) return 'horário combinado';
    return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  }
}
