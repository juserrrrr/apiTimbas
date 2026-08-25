import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CompetitionGame, Prisma, TournamentMatch, TournamentMatchStatus } from '@prisma/client';
import { Actor } from '../common/actor.service';
import { PrismaService } from '../prisma/prisma.service';
import { EaFcClubsService } from '../ea-fc-clubs/ea-fc-clubs.service';
import { FEATURE_TOURNAMENT_AI_RESULTS, FEATURE_TOURNAMENT_EA_RESULTS } from '../feature-flags/feature-flags.constants';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { EaClubMatch, EaClubMatchPlayer } from '../ea-fc-clubs/ea-fc-clubs.types';
import { analyzeEaMatchScore } from '../ea-fc-clubs/ea-score-analysis';
import { TournamentAccessService } from './tournament-access.service';
import { TournamentResultService } from './tournament-result.service';
import { ClaimResultDto, MatchMessageDto, ProposeScheduleDto, RequestMatchReviewDto, RespondClaimDto, RespondScheduleDto } from './dto/tournament.dto';

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
    private readonly eaClubs: EaFcClubsService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  async view(tournamentId: string, matchId: string, actor: Actor) {
    const match = await this.requireMatchDetail(tournamentId, matchId);
    const access = await this.access.of(tournamentId, actor);
    const side = this.sideOf(match, access.teamIds);
    if (!side && !access.canModerate) {
      throw new ForbiddenException('Só quem joga a partida ou a organização vê esta conversa.');
    }

    const [messages, tournament, eaEnabled, aiEnabled] = await Promise.all([
      this.prisma.tournamentMatchMessage.findMany({
        where: { matchId },
        orderBy: { createdAt: 'asc' },
        take: 200,
        include: { user: { select: { id: true, name: true, avatar: true } } },
      }),
      this.access.requireExists(tournamentId),
      this.featureFlags.isEnabled(FEATURE_TOURNAMENT_EA_RESULTS),
      this.featureFlags.isEnabled(FEATURE_TOURNAMENT_AI_RESULTS),
    ]);

    return {
      match,
      messages,
      mySide: side,
      canModerate: access.canModerate,
      deadlineAt: this.deadlineOf(match, tournament),
      matchWindowMinutes: tournament.matchWindowMinutes,
      graceMinutes: tournament.graceMinutes,
      requireOpponentConfirm: tournament.requireOpponentConfirm,
      resultMode: tournament.game === CompetitionGame.EA_FC && eaEnabled ? 'EA_API' : aiEnabled ? 'AI_IMAGE' : 'MANUAL',
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
    const [eaEnabled, aiEnabled] = await Promise.all([
      this.featureFlags.isEnabled(FEATURE_TOURNAMENT_EA_RESULTS),
      this.featureFlags.isEnabled(FEATURE_TOURNAMENT_AI_RESULTS),
    ]);
    if ((tournament.game === CompetitionGame.EA_FC && eaEnabled) || aiEnabled) {
      throw new BadRequestException('O placar manual só fica disponível quando API da EA e IA estão desligadas.');
    }
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
  async checkEaResult(tournamentId: string, matchId: string, actor: Actor, selectedEaMatchId?: string) {
    await this.featureFlags.ensureEnabled(FEATURE_TOURNAMENT_EA_RESULTS);
    const match = await this.prisma.tournamentMatch.findFirst({
      where: { id: matchId, tournamentId },
      include: { tournament: true, homeTeam: true, awayTeam: true },
    });
    if (!match) throw new NotFoundException('Partida não encontrada neste campeonato.');
    const { side, canModerate } = await this.requireParticipant(tournamentId, match, actor);
    if (!side && !canModerate) throw new ForbiddenException('Só quem joga ou a organização pode checar o resultado.');
    this.assertOpen(match);
    if (match.tournament.game !== CompetitionGame.EA_FC) throw new BadRequestException('Esta partida não é de EA Sports FC.');
    const checkedInAt = match.homeReadyAt && match.awayReadyAt
      ? new Date(Math.max(match.homeReadyAt.getTime(), match.awayReadyAt.getTime()))
      : null;
    if (match.tournament.matchWindowMinutes > 0 && !checkedInAt) {
      throw new BadRequestException('Os dois times precisam marcar Pronto para jogar antes de buscar o resultado na EA.');
    }
    const searchAnchor = match.tournament.matchWindowMinutes > 0 ? checkedInAt : match.scheduledAt;
    if (!searchAnchor) throw new BadRequestException('Marque o horário da partida antes de procurar o resultado na EA.');
    if (!match.homeTeam?.eaClubId || !match.awayTeam?.eaClubId) {
      throw new BadRequestException('Os dois times precisam ter um clube validado na EA.');
    }

    const platform = (match.homeTeam.eaPlatform ?? 'common-gen5') as 'common-gen5';
    if ((match.awayTeam.eaPlatform ?? 'common-gen5') !== platform) {
      throw new BadRequestException('Os clubes estão cadastrados em plataformas diferentes.');
    }
    const [homeHistory, awayHistory] = await Promise.all([
      this.eaClubs.friendlyMatches(match.homeTeam.eaClubId, platform),
      this.eaClubs.friendlyMatches(match.awayTeam.eaClubId, platform),
    ]);
    const awayById = new Map(awayHistory.map((item) => [item.externalMatchId, item]));
    // Em operações do Laboratório aceitamos até duas horas antes do horário
    // marcado. Isso permite validar rapidamente um evento reconstruído depois
    // que os amistosos reais já aconteceram. Campeonatos normais continuam sem
    // tolerância para trás, evitando reaproveitar resultados antigos.
    const earliest = searchAnchor.getTime() - (match.tournament.labMode ? 2 * 60 * 60 * 1000 : 0);
    // Live Lab operations are followed manually by an admin and may run all night.
    // Keep the lower bound to prevent old result reuse, but do not expire the search.
    const latest = match.tournament.labMode
      ? Number.POSITIVE_INFINITY
      : searchAnchor.getTime() + 4 * 60 * 60 * 1000;
    if (Date.now() < earliest) {
      throw new BadRequestException('A checagem na EA só fica disponível quando o confronto começar.');
    }
    const candidates = homeHistory.filter((item) => {
      const clubs = new Set([item.homeClubId, item.awayClubId]);
      const awayCopy = awayById.get(item.externalMatchId);
      return Boolean(awayCopy) && awayCopy!.homeClubId === item.homeClubId && awayCopy!.awayClubId === item.awayClubId &&
        awayCopy!.homeScore === item.homeScore && awayCopy!.awayScore === item.awayScore &&
        clubs.has(match.homeTeam!.eaClubId!) && clubs.has(match.awayTeam!.eaClubId!) &&
        item.playedAt.getTime() >= earliest && item.playedAt.getTime() <= latest;
    });
    if (candidates.length === 0) {
      throw new NotFoundException('A partida ainda não apareceu no histórico de amistosos dos dois clubes.');
    }
    const completeCandidates = candidates.filter((candidate) => !this.eaScoreAnalysis(candidate).interrupted);
    if (completeCandidates.length === 0) {
      throw new NotFoundException('A EA encontrou somente uma tentativa interrompida entre os clubes. Ela foi ignorada. Joguem novamente e depois use Rescanear EA.');
    }
    const usedEaMatches = await this.prisma.tournamentMatch.findMany({
      where: { eaMatchId: { in: completeCandidates.map((candidate) => candidate.externalMatchId) } },
      select: { eaMatchId: true },
    });
    const usedIds = new Set(usedEaMatches.flatMap((item) => item.eaMatchId ? [item.eaMatchId] : []));
    const available = completeCandidates
      .filter((candidate) => !usedIds.has(candidate.externalMatchId))
      .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());
    if (available.length === 0) {
      throw new BadRequestException('Todos os amistosos encontrados entre esses clubes já foram usados no campeonato.');
    }
    if ((available.length > 1 || match.tournament.labMode || available.some((candidate) => this.isSuspiciousEaScore(candidate))) && !selectedEaMatchId) {
      return {
        selectionRequired: true as const,
        candidates: available.map((candidate) => {
          const tournamentHomeIsEaHome = candidate.homeClubId === match.homeTeam!.eaClubId;
          const suspiciousScore = this.isSuspiciousEaScore(candidate);
          const effective = this.effectiveEaScore(candidate);
          return {
            eaMatchId: candidate.externalMatchId,
            playedAt: candidate.playedAt,
            homeScore: tournamentHomeIsEaHome ? effective.homeScore : effective.awayScore,
            awayScore: tournamentHomeIsEaHome ? effective.awayScore : effective.homeScore,
            officialHomeScore: tournamentHomeIsEaHome ? candidate.homeScore : candidate.awayScore,
            officialAwayScore: tournamentHomeIsEaHome ? candidate.awayScore : candidate.homeScore,
            suspiciousScore,
            warning: suspiciousScore ? this.eaScoreWarning(candidate) : undefined,
          };
        }),
      };
    }
    // No Laboratório toda opção exige confirmação, inclusive quando a EA ainda
    // só publicou um amistoso. Isso impede consumir uma partida antiga enquanto
    // o resultado recém-jogado ainda não apareceu no histórico. Fora do Lab, uma
    // única opção é automática; havendo mais de uma, a escolha é explícita.
    const eaMatch = selectedEaMatchId
      ? available.find((candidate) => candidate.externalMatchId === selectedEaMatchId)
      : available[0];
    if (!eaMatch) {
      throw new BadRequestException('A partida da EA escolhida não pertence às opções válidas deste confronto.');
    }
    const suspiciousScore = this.isSuspiciousEaScore(eaMatch);
    if (suspiciousScore && !canModerate) {
      throw new BadRequestException('O placar geral da EA diverge do SCORE dos atletas. Somente a organização pode revisar e confirmar esse resultado.');
    }

    const tournamentHomeIsEaHome = eaMatch.homeClubId === match.homeTeam.eaClubId;
    const effective = this.effectiveEaScore(eaMatch);
    const homeScore = tournamentHomeIsEaHome ? effective.homeScore : effective.awayScore;
    const awayScore = tournamentHomeIsEaHome ? effective.awayScore : effective.homeScore;
    const officialHomeScore = tournamentHomeIsEaHome ? eaMatch.homeScore : eaMatch.awayScore;
    const officialAwayScore = tournamentHomeIsEaHome ? eaMatch.awayScore : eaMatch.homeScore;
    const matchTags = this.matchTags(eaMatch, effective.homeScore, effective.awayScore);
    const settled = await this.results.settle(matchId, homeScore, awayScore, actor.discordId, async (tx) => {
      await tx.tournamentMatch.update({
        where: { id: matchId },
        data: {
          eaMatchId: eaMatch.externalMatchId,
          eaVerifiedAt: new Date(),
          eaRaw: eaMatch.rawData as Prisma.InputJsonValue,
          eaTags: matchTags,
        },
      });
      const rows = [
        ...this.playerRows(matchId, eaMatch, match.homeTeam!.eaClubId!, match.homeTeamId!),
        ...this.playerRows(matchId, eaMatch, match.awayTeam!.eaClubId!, match.awayTeamId!),
      ];
      if (rows.length) await tx.tournamentEaPlayerStat.createMany({ data: rows });
    });
    await this.systemMessage(matchId, null, suspiciousScore
      ? `A organização confirmou ${homeScore} a ${awayScore} pelo SCORE dos atletas. O cabeçalho da EA informava ${officialHomeScore} a ${officialAwayScore}.`
      : `Resultado confirmado pela EA: ${homeScore} a ${awayScore}. Estatísticas sincronizadas.`);
    return settled;
  }

  async rescanClosedLabEaResult(tournamentId: string, matchId: string, actor: Actor) {
    await this.featureFlags.ensureEnabled(FEATURE_TOURNAMENT_EA_RESULTS);
    const match = await this.prisma.tournamentMatch.findFirst({
      where: { id: matchId, tournamentId },
      include: { tournament: true, homeTeam: true, awayTeam: true },
    });
    if (!match) throw new NotFoundException('Partida não encontrada neste campeonato.');
    const access = await this.access.of(tournamentId, actor);
    if (!access.canModerate) throw new ForbiddenException('Somente a organização pode reanalisar um resultado encerrado.');
    if (!match.tournament.labMode) throw new BadRequestException('A reanálise de resultado encerrado está disponível somente no Laboratório.');
    if (match.status !== TournamentMatchStatus.FINISHED && match.status !== TournamentMatchStatus.WALKOVER) {
      throw new BadRequestException('A partida ainda não possui resultado encerrado para reanalisar.');
    }
    if (!match.eaMatchId || !match.homeTeam?.eaClubId || !match.awayTeam?.eaClubId) {
      throw new BadRequestException('Esta partida não possui um EA Match ID e dois clubes validados.');
    }
    const platform = (match.homeTeam.eaPlatform ?? 'common-gen5') as 'common-gen5';
    const [homeHistory, awayHistory] = await Promise.all([
      this.eaClubs.friendlyMatches(match.homeTeam.eaClubId, platform),
      this.eaClubs.friendlyMatches(match.awayTeam.eaClubId, platform),
    ]);
    const refreshed = homeHistory.find((item) => item.externalMatchId === match.eaMatchId);
    const awayCopy = awayHistory.find((item) => item.externalMatchId === match.eaMatchId);
    if (!refreshed || !awayCopy) {
      throw new NotFoundException('A EA não retornou mais esse Match ID entre os amistosos recentes dos dois clubes.');
    }
    const analysis = this.eaScoreAnalysis(refreshed);
    const tournamentHomeIsEaHome = refreshed.homeClubId === match.homeTeam.eaClubId;
    const orient = (score: { homeScore: number; awayScore: number }) => tournamentHomeIsEaHome
      ? score
      : { homeScore: score.awayScore, awayScore: score.homeScore };
    const official = orient({ homeScore: refreshed.homeScore, awayScore: refreshed.awayScore });
    const playerScore = analysis.playerScore ? orient(analysis.playerScore) : null;
    await this.prisma.tournamentMatch.update({
      where: { id: matchId },
      data: { eaRaw: refreshed.rawData as Prisma.InputJsonValue, eaVerifiedAt: new Date() },
    });
    return {
      eaMatchId: refreshed.externalMatchId,
      kind: analysis.interrupted ? 'INTERRUPTED' as const : analysis.scoreMismatch ? 'SCORE_MISMATCH' as const : 'CONSISTENT' as const,
      officialHomeScore: official.homeScore,
      officialAwayScore: official.awayScore,
      inferredHomeScore: playerScore?.homeScore ?? official.homeScore,
      inferredAwayScore: playerScore?.awayScore ?? official.awayScore,
      durationSeconds: Math.max(analysis.homeDurationSeconds, analysis.awayDurationSeconds),
      nonZeroUserResults: analysis.nonZeroUserResults,
      playerCount: analysis.playerCount,
    };
  }

  async requestGrace(tournamentId: string, matchId: string, actor: Actor) {
    const tournament = await this.access.requireExists(tournamentId);
    const match = await this.requireMatch(tournamentId, matchId);
    const { side } = await this.requireParticipant(tournamentId, match, actor);
    if (!side) throw new ForbiddenException('Só quem joga a partida pode pedir tolerância.');
    this.assertOpen(match);
    if (tournament.graceMinutes <= 0) throw new BadRequestException('Este campeonato não oferece tolerância.');
    if (tournament.matchWindowMinutes > 0) {
      const beginsAt = Math.max(match.readyAt?.getTime() ?? 0, tournament.startsAt?.getTime() ?? 0);
      if (!beginsAt || Date.now() < beginsAt) throw new BadRequestException('A tolerância abre quando o confronto começar.');
      const deadline = this.deadlineOf(match, tournament);
      if (deadline && deadline.getTime() <= Date.now()) throw new BadRequestException('O prazo de check-in já terminou.');
    }
    if (match.homeReadyAt && match.awayReadyAt) {
      throw new BadRequestException('Os dois times já confirmaram presença e a partida foi liberada.');
    }
    if (side === 'HOME' ? match.homeGraceUsed : match.awayGraceUsed) {
      throw new BadRequestException('Seu time já usou a tolerância nesta partida.');
    }
    const teamId = side === 'HOME' ? match.homeTeamId! : match.awayTeamId!;
    const updated = await this.prisma.tournamentMatch.update({
      where: { id: matchId },
      data: side === 'HOME' ? { homeGraceUsed: true } : { awayGraceUsed: true },
    });
    await this.systemMessage(matchId, teamId, `Pediu ${tournament.graceMinutes} minutos de tolerância.`);
    return updated;
  }

  async setReady(tournamentId: string, matchId: string, ready: boolean, actor: Actor) {
    const tournament = await this.access.requireExists(tournamentId);
    const match = await this.requireMatch(tournamentId, matchId);
    const { side } = await this.requireParticipant(tournamentId, match, actor);
    if (!side) throw new ForbiddenException('Só quem joga a partida pode confirmar presença.');
    this.assertOpen(match);
    if (tournament.matchWindowMinutes <= 0) {
      throw new BadRequestException('O check-in Pronto para jogar está disponível somente em confrontos rápidos.');
    }

    const beginsAt = Math.max(match.readyAt?.getTime() ?? 0, tournament.startsAt?.getTime() ?? 0);
    if (!beginsAt || Date.now() < beginsAt) {
      throw new BadRequestException('O check-in abre quando o confronto começar.');
    }
    const deadline = this.deadlineOf(match, tournament);
    if (deadline && deadline.getTime() <= Date.now()) {
      throw new BadRequestException('O prazo de check-in desta partida já terminou.');
    }

    const currentReadyAt = side === 'HOME' ? match.homeReadyAt : match.awayReadyAt;
    if (Boolean(currentReadyAt) === ready) return match;
    if (!ready && match.homeReadyAt && match.awayReadyAt) {
      throw new BadRequestException('Os dois times já estão prontos e a partida foi iniciada.');
    }

    const teamId = side === 'HOME' ? match.homeTeamId! : match.awayTeamId!;
    const updated = await this.prisma.tournamentMatch.update({
      where: { id: matchId },
      data: side === 'HOME'
        ? { homeReadyAt: ready ? new Date() : null }
        : { awayReadyAt: ready ? new Date() : null },
    });
    await this.systemMessage(matchId, teamId, ready ? 'Marcou Pronto para jogar.' : 'Desmarcou Pronto para jogar.');
    if (updated.homeReadyAt && updated.awayReadyAt) {
      await this.systemMessage(matchId, null, 'Os dois times estão prontos. Partida liberada para jogar e sincronizar na EA.');
    }
    return updated;
  }

  async requestReview(tournamentId: string, matchId: string, dto: RequestMatchReviewDto, actor: Actor) {
    const match = await this.requireMatch(tournamentId, matchId);
    const { side } = await this.requireParticipant(tournamentId, match, actor);
    if (!side) throw new ForbiddenException('Só quem joga a partida pode pedir análise da organização.');
    this.assertOpen(match);
    const updated = await this.prisma.tournamentMatch.update({
      where: { id: matchId },
      data: { status: TournamentMatchStatus.DISPUTED, reviewRequestedAt: new Date(), reviewRequestedById: actor.id, reviewReason: dto.reason },
    });
    await this.systemMessage(matchId, side === 'HOME' ? match.homeTeamId : match.awayTeamId, `Solicitou análise da organização: ${dto.reason}`);
    return updated;
  }

  async pendingReviews(tournamentId: string, actor: Actor) {
    await this.access.requireManage(tournamentId, actor);
    return this.prisma.tournamentMatch.findMany({
      where: { tournamentId, status: TournamentMatchStatus.DISPUTED, reviewRequestedAt: { not: null } },
      orderBy: { reviewRequestedAt: 'asc' },
      include: { homeTeam: true, awayTeam: true },
    });
  }

  async resolveReview(tournamentId: string, matchId: string, dto: ClaimResultDto, actor: Actor) {
    await this.access.requireManage(tournamentId, actor);
    const match = await this.requireMatch(tournamentId, matchId);
    const tournament = await this.access.requireExists(tournamentId);
    this.results.assertScoreIsValid(match, tournament, dto.homeScore, dto.awayScore);
    return this.results.settle(matchId, dto.homeScore, dto.awayScore, actor.discordId);
  }

  private playerRows(matchId: string, match: EaClubMatch, clubId: string, teamId: string) {
    return (match.playersByClub[clubId] ?? []).map((player) => ({
      matchId,
      teamId,
      externalPlayerId: player.externalPlayerId,
      playerName: player.playerName,
      position: player.position,
      rating: player.rating,
      goals: player.goals,
      assists: player.assists,
      shots: player.shots,
      passesAttempted: player.passesAttempted,
      passesCompleted: player.passesCompleted,
      tacklesAttempted: player.tacklesAttempted,
      tacklesCompleted: player.tacklesCompleted,
      saves: player.saves,
      yellowCards: player.yellowCards,
      redCards: player.redCards,
      manOfTheMatch: player.manOfTheMatch,
      tags: this.playerTags(player),
    }));
  }

  private playerTags(player: EaClubMatchPlayer): string[] {
    return [
      ...(player.manOfTheMatch ? ['MVP'] : []),
      ...(player.goals >= 3 ? ['HAT_TRICK'] : []),
      ...(player.goals >= 2 ? ['DOIS_GOLS'] : []),
      ...(player.assists >= 3 ? ['MAESTRO'] : []),
      ...((player.saves ?? 0) >= 5 ? ['PAREDAO'] : []),
      ...((player.rating ?? 0) >= 9 ? ['NOTA_9_PLUS'] : []),
    ];
  }

  private matchTags(match: EaClubMatch, homeScore = match.homeScore, awayScore = match.awayScore): string[] {
    return [
      ...(this.isSuspiciousEaScore(match) ? ['EA_SCORE_SUSPEITO'] : []),
      ...(homeScore === 0 || awayScore === 0 ? ['CLEAN_SHEET'] : []),
      ...(homeScore + awayScore >= 7 ? ['CHUVA_DE_GOLS'] : []),
      ...(Math.abs(homeScore - awayScore) >= 4 ? ['GOLEADA'] : []),
    ];
  }

  private isSuspiciousEaScore(match: EaClubMatch): boolean {
    const analysis = this.eaScoreAnalysis(match);
    if (analysis.interrupted) return true;
    if (analysis.playerScore) return analysis.scoreMismatch;
    const isThreeNil = (match.homeScore === 3 && match.awayScore === 0) ||
      (match.homeScore === 0 && match.awayScore === 3);
    if (!isThreeNil) return false;
    const humanGoals = Object.values(match.playersByClub)
      .flat()
      .reduce((total, player) => total + player.goals, 0);
    const rawClubs = match.rawData.clubs;
    const hasDnf = rawClubs !== null && typeof rawClubs === 'object' &&
      Object.values(rawClubs).some((club) => club !== null && typeof club === 'object' &&
        String((club as Record<string, unknown>).winnerByDnf ?? '0') === '1');
    return humanGoals === 0 && !hasDnf;
  }

  private eaScoreAnalysis(match: EaClubMatch) {
    return analyzeEaMatchScore(match.rawData, match.homeClubId, match.awayClubId, match.homeScore, match.awayScore);
  }

  private effectiveEaScore(match: EaClubMatch) {
    const analysis = this.eaScoreAnalysis(match);
    return analysis.playerScore && !analysis.interrupted
      ? analysis.playerScore
      : { homeScore: match.homeScore, awayScore: match.awayScore };
  }

  private eaScoreWarning(match: EaClubMatch): string {
    const analysis = this.eaScoreAnalysis(match);
    if (analysis.interrupted) {
      return `Tentativa interrompida com no máximo ${Math.max(analysis.homeDurationSeconds, analysis.awayDurationSeconds)} segundos. Este registro não pode ser usado.`;
    }
    if (analysis.playerScore && analysis.scoreMismatch) {
      return 'O cabeçalho da EA diverge do SCORE predominante dos atletas. Ao confirmar, será usado o placar dos atletas exibido acima.';
    }
    return 'Placar 3 a 0 sem gols atribuídos aos jogadores e sem DNF declarado pela EA.';
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async resolveDeadlines() {
    const tournaments = await this.prisma.tournament.findMany({
      where: { status: 'RUNNING', OR: [{ matchWindowMinutes: { gt: 0 } }, { woAfterHours: { gt: 0 } }] },
      select: { id: true, name: true, woAfterHours: true, matchWindowMinutes: true, graceMinutes: true, startsAt: true },
    });

    for (const tournament of tournaments) {
      const candidates = await this.prisma.tournamentMatch.findMany({
        where: {
          tournamentId: tournament.id,
          status: { in: [TournamentMatchStatus.READY, TournamentMatchStatus.AWAITING_PROOF] },
          readyAt: { not: null },
          homeTeamId: { not: null },
          awayTeamId: { not: null },
        },
        include: {
          homeTeam: { select: { id: true, name: true, seed: true } },
          awayTeam: { select: { id: true, name: true, seed: true } },
        },
        take: 40,
      });

      const late = candidates.filter((match) => {
        const deadline = this.deadlineOf(match, tournament);
        return deadline !== null && deadline.getTime() <= Date.now();
      });
      for (const match of late) {
        try {
          await this.applyDeadline(match, tournament);
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
    tournament: { name: string; matchWindowMinutes: number },
  ) {
    if (tournament.matchWindowMinutes > 0) {
      const homeReady = match.homeReadyAt !== null;
      const awayReady = match.awayReadyAt !== null;
      if (homeReady && awayReady) return;
      if (!homeReady && !awayReady) {
        await this.systemMessage(match.id, null, 'Prazo de check-in encerrado sem nenhum time pronto. A organização vai decidir.');
        await this.prisma.tournamentMatch.update({
          where: { id: match.id },
          data: {
            status: TournamentMatchStatus.DISPUTED,
            reviewRequestedAt: new Date(),
            reviewReason: 'Nenhum time confirmou presença no prazo.',
          },
        });
        return;
      }

      const winner = homeReady ? match.homeTeam! : match.awayTeam!;
      const reason = 'adversário não confirmou presença no prazo';
      await this.systemMessage(match.id, winner.id, `W.O. para ${winner.name}: ${reason}.`);
      await this.results.walkover(match.tournamentId, match.id, winner.id, reason, 'prazo');
      this.logger.log(`${tournament.name}: W.O. para ${winner.name} (${reason}).`);
      return;
    }

    const engaged = await this.engagedTeams(match);
    const homeEngaged = engaged.has(match.homeTeamId!);
    const awayEngaged = engaged.has(match.awayTeamId!);

    if (homeEngaged && awayEngaged) {
      await this.systemMessage(match.id, null, 'Prazo estourado com os dois times ativos. A organização vai decidir.');
      await this.prisma.tournamentMatch.update({
        where: { id: match.id },
        data: { status: TournamentMatchStatus.DISPUTED, reviewRequestedAt: new Date() },
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
    this.logger.log(`${tournament.name}: W.O. para ${winner.name} (${reason}).`);
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

  private deadlineOf(
    match: TournamentMatch,
    tournament: { woAfterHours: number; matchWindowMinutes: number; graceMinutes: number; startsAt: Date | null },
  ): Date | null {
    if (!match.readyAt) return null;
    if (!OPEN_STATUSES.includes(match.status)) return null;
    if (tournament.matchWindowMinutes > 0 && match.homeReadyAt && match.awayReadyAt) return null;
    const base = Math.max(match.readyAt.getTime(), tournament.startsAt?.getTime() ?? 0);
    const regularMinutes = tournament.matchWindowMinutes > 0
      ? tournament.matchWindowMinutes
      : tournament.woAfterHours * 60;
    if (regularMinutes <= 0) return null;
    const graceUses = Number(match.homeGraceUsed) + Number(match.awayGraceUsed);
    return new Date(base + (regularMinutes + graceUses * tournament.graceMinutes) * 60_000);
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

  private async requireMatchDetail(tournamentId: string, matchId: string) {
    const match = await this.prisma.tournamentMatch.findFirst({
      where: { id: matchId, tournamentId },
      include: {
        homeTeam: { select: { id: true, name: true, tag: true, logoUrl: true, seed: true } },
        awayTeam: { select: { id: true, name: true, tag: true, logoUrl: true, seed: true } },
        eaPlayerStats: { orderBy: [{ rating: 'desc' }, { goals: 'desc' }] },
      },
    });
    if (!match) throw new NotFoundException('Partida nÃ£o encontrada neste campeonato.');
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
