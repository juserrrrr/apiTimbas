import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  DraftLeagueStatus,
  DraftResultMode,
  Role,
  TournamentFormat,
  TournamentMatchStatus,
  TournamentStatus,
} from '@prisma/client';
import { Actor } from '../common/actor.service';
import { marketValueFor, salaryFor } from '../football/market-value';
import { DraftFixtureService } from '../draft/draft-fixture.service';
import { DraftPickService } from '../draft/draft-pick.service';
import { DraftSimulationService } from '../draft/draft-simulation.service';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentResultService } from '../tournament/tournament-result.service';
import { TournamentService } from '../tournament/tournament.service';
import {
  DEMO_DISCORD_PREFIX,
  DEMO_FIRST_NAMES,
  DEMO_LAST_NAMES,
  DEMO_POSITIONS,
  DEMO_PREFIX,
  DEMO_TEAM_NAMES,
} from './demo.constants';
import { BuildDemoDraftDto, BuildDemoTournamentDto } from './dto/demo.dto';

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tournaments: TournamentService,
    private readonly results: TournamentResultService,
    private readonly picks: DraftPickService,
    private readonly fixtures: DraftFixtureService,
    private readonly simulation: DraftSimulationService,
  ) {}

  async buildTournament(dto: BuildDemoTournamentDto, actor: Actor) {
    try {
      return await this.buildTournamentInner(dto, actor);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao gerar campeonato de demonstração (${dto.stage}): ${detail}`, (error as Error)?.stack);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Falha ao gerar o campeonato no estágio ${dto.stage}: ${detail}`);
    }
  }

  private async buildTournamentInner(dto: BuildDemoTournamentDto, actor: Actor) {
    const teamCount = dto.teamCount ?? 8;
    if (teamCount > DEMO_TEAM_NAMES.length) {
      throw new BadRequestException(`Máximo de ${DEMO_TEAM_NAMES.length} times de demonstração.`);
    }

    const format = dto.format ?? TournamentFormat.SINGLE_ELIMINATION;
    const tournament = await this.tournaments.create(
      {
        name: `${DEMO_PREFIX} ${labelFor(format)} ${teamCount}`,
        description: 'Campeonato de demonstração criado pelo painel de administração. Pode apagar à vontade.',
        format,
        maxTeams: teamCount,
        groupCount: dto.groupCount ?? 2,
        advancePerGroup: dto.advancePerGroup ?? 2,
        legs: dto.legs ?? 1,
        thirdPlace: dto.thirdPlace ?? format === TournamentFormat.SINGLE_ELIMINATION,
        requireProof: false,
        coinsWin: 0,
        coinsDraw: 0,
        coinsLoss: 0,
        coinsChampion: 0,
        coinsRunnerUp: 0,
      },
      actor,
    );

    for (let index = 0; index < teamCount; index++) {
      await this.prisma.tournamentTeam.create({
        data: {
          tournamentId: tournament.id,
          name: DEMO_TEAM_NAMES[index],
          tag: DEMO_TEAM_NAMES[index].slice(0, 3).toUpperCase(),
          seed: index + 1,
        },
      });
    }

    if (dto.stage === 'REGISTRATION') {
      return this.tournamentSummary(tournament.id, 'Times inscritos, aguardando início.');
    }

    await this.tournaments.start(tournament.id, actor);
    await this.seedMatchRoom(tournament.id);
    if (dto.stage === 'STARTED') {
      return this.tournamentSummary(
        tournament.id,
        'Chaveamento gerado, com uma partida já tendo conversa, proposta de horário e placar aguardando confirmação.',
      );
    }

    const played = await this.simulate(tournament.id, dto.stage === 'PARTIAL');
    return this.tournamentSummary(
      tournament.id,
      dto.stage === 'PARTIAL'
        ? `${played} partidas simuladas, metade da chave preenchida.`
        : `${played} partidas simuladas até sair o campeão.`,
    );
  }

  async buildDraftLeague(dto: BuildDemoDraftDto, actor: Actor) {
    try {
      return await this.buildDraftLeagueInner(dto, actor);
    } catch (error) {
      // O laboratório existe para achar defeito: o erro cru vai para o log com a
      // pilha, e a tela recebe a causa em vez de "erro interno".
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao gerar liga de demonstração (${dto.stage}): ${detail}`, (error as Error)?.stack);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Falha ao gerar a liga no estágio ${dto.stage}: ${detail}`);
    }
  }

  private async buildDraftLeagueInner(dto: BuildDemoDraftDto, actor: Actor) {
    const rosterCount = dto.rosterCount ?? 4;
    const rosterSize = dto.rosterSize ?? 11;
    const poolSize = Math.max(rosterCount * rosterSize + 10, 30);

    const league = await this.prisma.draftLeague.create({
      data: {
        name: `${DEMO_PREFIX} Liga Draft ${rosterCount} elencos`,
        description: 'Liga de demonstração criada pelo painel de administração. Pode apagar à vontade.',
        rosterSize,
        pickSeconds: 3600,
        resultMode: dto.resultMode ?? DraftResultMode.REPORTED,
        startingBudget: dto.startingBudget ?? 1000,
        paySalaries: dto.paySalaries ?? true,
        auctionsEnabled: dto.auctionsEnabled ?? true,
        auctionHours: dto.auctionHours ?? 24,
        coinsWin: 60,
        coinsDraw: 25,
        coinsLoss: 10,
        createdByDiscordId: actor.discordId,
        staff: { create: { userId: actor.id, role: 'OWNER' } },
      },
    });

    await this.prisma.draftPlayer.createMany({
      data: Array.from({ length: poolSize }, (_, index) => ({
        leagueId: league.id,
        name: demoPlayerName(index),
        position: DEMO_POSITIONS[index % DEMO_POSITIONS.length],
        overall: 62 + ((index * 7) % 32),
        realTeam: DEMO_TEAM_NAMES[index % DEMO_TEAM_NAMES.length],
        price: marketValueFor(62 + ((index * 7) % 32)),
        salary: salaryFor(marketValueFor(62 + ((index * 7) % 32))),
        pace: 55 + ((index * 5) % 40),
        shooting: 55 + ((index * 7) % 40),
        passing: 55 + ((index * 11) % 40),
        dribbling: 55 + ((index * 3) % 40),
        defending: 45 + ((index * 13) % 45),
        physical: 55 + ((index * 17) % 40),
      })),
    });

    // O primeiro elenco é de quem apertou o botão: sem isso não dá para abrir a
    // aba "Meu elenco" e ver a liga do lado de dentro. Os últimos podem ficar
    // vagos, para dar para ver a liga rodando sem gente suficiente.
    const vacant = Math.min(dto.vacantRosters ?? 0, rosterCount - 1);
    const withOwner = rosterCount - vacant;
    const managers = [actor, ...(await this.ensureDemoUsers(withOwner - 1))];

    for (let index = 0; index < rosterCount; index++) {
      const manager = managers[index];
      await this.prisma.draftRoster.create({
        data: {
          leagueId: league.id,
          userId: manager?.id ?? null,
          name: manager
            ? index === 0
              ? `${DEMO_TEAM_NAMES[index]} (seu)`
              : DEMO_TEAM_NAMES[index]
            : `${DEMO_TEAM_NAMES[index]} (vaga)`,
          tag: DEMO_TEAM_NAMES[index].slice(0, 3).toUpperCase(),
          draftOrder: index + 1,
          budget: league.startingBudget,
        },
      });
    }

    if (dto.stage === 'SETUP') {
      return this.draftSummary(league.id, 'Elencos inscritos e pool carregado, draft ainda não começou.');
    }

    await this.picks.startDraft(league.id, actor, false);
    if (dto.stage === 'DRAFTING') {
      return this.draftSummary(league.id, 'Draft aberto com o cronômetro rodando.');
    }

    await this.fillRosters(league.id);
    if (dto.stage === 'ACTIVE') {
      return this.draftSummary(league.id, 'Elencos completos e rodadas agendadas.');
    }

    const played = await this.simulateDraftRounds(league.id, actor);
    return this.draftSummary(league.id, `${played} rodadas simuladas.`);
  }

  async clear() {
    const [tournaments, leagues] = await Promise.all([
      this.prisma.tournament.deleteMany({ where: { name: { startsWith: DEMO_PREFIX } } }),
      this.prisma.draftLeague.deleteMany({ where: { name: { startsWith: DEMO_PREFIX } } }),
    ]);
    const users = await this.prisma.user.deleteMany({
      where: { discordId: { startsWith: DEMO_DISCORD_PREFIX } },
    });

    return {
      tournaments: tournaments.count,
      leagues: leagues.count,
      users: users.count,
    };
  }

  async list() {
    const [tournaments, leagues] = await Promise.all([
      this.prisma.tournament.findMany({
        where: { name: { startsWith: DEMO_PREFIX } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, format: true, status: true, createdAt: true },
      }),
      this.prisma.draftLeague.findMany({
        where: { name: { startsWith: DEMO_PREFIX } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, status: true, createdAt: true },
      }),
    ]);
    return { tournaments, leagues };
  }

  /// Deixa a primeira partida com a sala cheia: conversa, proposta de horário e um
  /// placar esperando o adversário confirmar. É o que a tela precisa para dar para
  /// conferir o fluxo sem combinar nada com ninguém.
  private async seedMatchRoom(tournamentId: string) {
    const match = await this.prisma.tournamentMatch.findFirst({
      where: { tournamentId, status: TournamentMatchStatus.READY, homeTeamId: { not: null }, awayTeamId: { not: null } },
      orderBy: [{ round: 'asc' }, { position: 'asc' }],
      include: { homeTeam: { select: { id: true, name: true } }, awayTeam: { select: { id: true, name: true } } },
    });
    if (!match) return;

    const kickoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.prisma.tournamentMatch.update({
      where: { id: match.id },
      data: {
        scheduleProposedAt: kickoff,
        scheduleProposedByTeamId: match.homeTeamId,
        claimedHomeScore: 3,
        claimedAwayScore: 1,
        claimedByTeamId: match.homeTeamId,
        claimedAt: new Date(),
        status: TournamentMatchStatus.AWAITING_PROOF,
      },
    });

    await this.prisma.tournamentMatchMessage.createMany({
      data: [
        {
          matchId: match.id,
          teamId: match.homeTeamId,
          body: 'Fechado para amanhã à noite?',
          system: false,
        },
        {
          matchId: match.id,
          teamId: match.awayTeamId,
          body: 'Pode ser, confirmo mais tarde.',
          system: false,
        },
        {
          matchId: match.id,
          teamId: match.homeTeamId,
          body: `Propôs jogar em ${kickoff.toLocaleString('pt-BR')}.`,
          system: true,
        },
        {
          matchId: match.id,
          teamId: match.homeTeamId,
          body: 'Informou 3 a 1 e aguarda a confirmação do adversário.',
          system: true,
        },
      ],
    });
  }

  private async simulate(tournamentId: string, stopHalfway: boolean): Promise<number> {
    let played = 0;

    for (let guard = 0; guard < 200; guard++) {
      const open = await this.prisma.tournamentMatch.findMany({
        where: { tournamentId, status: TournamentMatchStatus.READY },
        orderBy: [{ round: 'asc' }, { position: 'asc' }],
      });
      if (open.length === 0) break;
      if (stopHalfway && played >= Math.ceil(open.length / 2) && played > 0) break;

      for (const match of open) {
        if (stopHalfway && played >= Math.max(1, Math.ceil(open.length / 2))) break;
        const home = 1 + Math.floor(Math.random() * 4);
        let away = Math.floor(Math.random() * 4);
        if (away === home) away = home > 0 ? home - 1 : home + 1;

        await this.results.settle(match.id, home, away, 'demo');
        played++;
      }
      if (stopHalfway) break;
    }

    return played;
  }

  private async fillRosters(leagueId: string) {
    const league = await this.prisma.draftLeague.findUniqueOrThrow({ where: { id: leagueId } });
    const rosters = await this.prisma.draftRoster.findMany({
      where: { leagueId },
      orderBy: { draftOrder: 'asc' },
    });
    const pool = await this.prisma.draftPlayer.findMany({
      where: { leagueId, rosterId: null },
      orderBy: { overall: 'desc' },
    });

    let pickNumber = 0;
    for (let round = 1; round <= league.rosterSize; round++) {
      const order = round % 2 === 0 ? [...rosters].reverse() : rosters;
      for (const roster of order) {
        const player = pool[pickNumber];
        if (!player) break;
        await this.prisma.draftPick.create({
          data: {
            leagueId,
            rosterId: roster.id,
            playerId: player.id,
            round,
            pickNumber,
            price: player.price,
          },
        });
        await this.prisma.draftPlayer.update({
          where: { id: player.id },
          data: { rosterId: roster.id, starter: true, slot: player.position },
        });
        pickNumber++;
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.draftLeague.update({
        where: { id: leagueId },
        data: {
          status: DraftLeagueStatus.ACTIVE,
          currentPickNumber: pickNumber,
          pickDeadline: null,
        },
      });
      await this.picks.generateFixtures(tx, updated);
    });
  }

  /// Passa pelo caminho real de cada modo: assim o demo exercita premiação,
  /// salário, nota do jogador e o motor de simulação, em vez de escrever placar
  /// na mão e mascarar bug.
  private async simulateDraftRounds(leagueId: string, actor: Actor): Promise<number> {
    const league = await this.prisma.draftLeague.findUniqueOrThrow({ where: { id: leagueId } });
    const matches = await this.prisma.draftMatch.findMany({
      where: { leagueId },
      orderBy: [{ round: 'asc' }, { scheduledAt: 'asc' }],
    });

    let played = 0;
    for (const match of matches) {
      if (league.resultMode === DraftResultMode.SIMULATED) {
        await this.simulation.playOne(leagueId, match.id);
      } else {
        const home = Math.floor(Math.random() * 5);
        const away = Math.floor(Math.random() * 5);
        await this.fixtures.report(leagueId, match.id, { homeScore: home, awayScore: away }, actor);
      }
      played++;
    }
    return played;
  }

  private async applyDemoRosterStats(
    rosterId: string,
    scored: number,
    conceded: number,
    pointsWin: number,
    pointsDraw: number,
  ) {
    const isWin = scored > conceded;
    const isDraw = scored === conceded;
    await this.prisma.draftRoster.update({
      where: { id: rosterId },
      data: {
        played: { increment: 1 },
        wins: { increment: isWin ? 1 : 0 },
        draws: { increment: isDraw ? 1 : 0 },
        losses: { increment: !isWin && !isDraw ? 1 : 0 },
        goalsFor: { increment: scored },
        goalsAgainst: { increment: conceded },
        points: { increment: isWin ? pointsWin : isDraw ? pointsDraw : 0 },
      },
    });
  }

  private async ensureDemoUsers(count: number) {
    const users = [];
    for (let index = 1; index <= count; index++) {
      users.push(
        await this.prisma.user.upsert({
          where: { discordId: `${DEMO_DISCORD_PREFIX}${index}` },
          update: {},
          create: {
            discordId: `${DEMO_DISCORD_PREFIX}${index}`,
            name: `Treinador ${index} (demo)`,
            role: Role.PLAYER,
          },
        }),
      );
    }
    return users;
  }

  /// O resumo é o debug da tela de admin: além do link, ele conta o que o
  /// gerador realmente produziu, para dar para conferir sem abrir o banco.
  private async tournamentSummary(id: string, message: string) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        format: true,
        status: true,
        groupCount: true,
        advancePerGroup: true,
        thirdPlace: true,
        woAfterHours: true,
        requireOpponentConfirm: true,
        _count: { select: { teams: true, matches: true } },
      },
    });

    const [byPhase, groups, finished, open, champion, messages, proposals, claims] = await Promise.all([
      this.prisma.tournamentMatch.groupBy({
        by: ['phase'],
        where: { tournamentId: id },
        _count: { _all: true },
      }),
      this.prisma.tournamentGroup.findMany({
        where: { tournamentId: id },
        orderBy: { order: 'asc' },
        select: { name: true, _count: { select: { teams: true, matches: true } } },
      }),
      this.prisma.tournamentMatch.count({ where: { tournamentId: id, status: 'FINISHED' } }),
      this.prisma.tournamentMatch.count({ where: { tournamentId: id, status: { in: ['PENDING', 'READY'] } } }),
      this.prisma.tournament.findUnique({ where: { id }, select: { championTeamId: true } }),
      this.prisma.tournamentMatchMessage.count({ where: { match: { tournamentId: id } } }),
      this.prisma.tournamentMatch.count({ where: { tournamentId: id, scheduleProposedAt: { not: null } } }),
      this.prisma.tournamentMatch.count({ where: { tournamentId: id, claimedByTeamId: { not: null } } }),
    ]);

    return {
      message,
      id: tournament.id,
      name: tournament.name,
      format: tournament.format,
      status: tournament.status,
      teams: tournament._count.teams,
      matches: tournament._count.matches,
      url: `/dashboard/tournaments/${tournament.id}`,
      debug: {
        partidasPorFase: Object.fromEntries(byPhase.map((row) => [row.phase, row._count._all])),
        grupos: groups.map((group) => `${group.name}: ${group._count.teams} times, ${group._count.matches} jogos`),
        classificadosPorGrupo: tournament.advancePerGroup,
        disputaDeTerceiro: tournament.thirdPlace,
        encerradas: finished,
        emAberto: open,
        mensagensNaSala: messages,
        propostasDeHorario: proposals,
        placaresAguardandoConfirmacao: claims,
        prazoParaWo: `${tournament.woAfterHours}h`,
        confirmacaoDoAdversario: tournament.requireOpponentConfirm,
        temCampeao: Boolean(champion?.championTeamId),
      },
    };
  }

  private async draftSummary(id: string, message: string) {
    const league = await this.prisma.draftLeague.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        resultMode: true,
        startingBudget: true,
        paySalaries: true,
        auctionsEnabled: true,
        auctionHours: true,
        auctionMinIncrementPercent: true,
        auctionAntiSnipeMinutes: true,
        totalRounds: true,
        currentRound: true,
        transferWindowOpen: true,
        _count: { select: { rosters: true, players: true, matches: true } },
      },
    });

    const [rosters, playedMatches, topScorer, entries, wages, openAuctions, vacantCount] = await Promise.all([
      this.prisma.draftRoster.findMany({
        where: { leagueId: id },
        orderBy: { points: 'desc' },
        select: { name: true, points: true, budget: true, earned: true, spent: true },
      }),
      this.prisma.draftMatch.count({ where: { leagueId: id, status: 'FINISHED' } }),
      this.prisma.draftPlayer.findFirst({
        where: { leagueId: id, goals: { gt: 0 } },
        orderBy: [{ goals: 'desc' }, { rating: 'desc' }],
        select: { name: true, goals: true, assists: true, rating: true },
      }),
      this.prisma.draftBudgetEntry.groupBy({
        by: ['type'],
        where: { leagueId: id },
        _sum: { amount: true },
      }),
      this.prisma.draftPlayer.aggregate({
        where: { leagueId: id, rosterId: { not: null } },
        _sum: { salary: true },
      }),
      this.prisma.draftAuction.count({ where: { leagueId: id, status: 'OPEN' } }),
      this.prisma.draftRoster.count({ where: { leagueId: id, userId: null } }),
    ]);

    return {
      message,
      id: league.id,
      name: league.name,
      status: league.status,
      rosters: league._count.rosters,
      players: league._count.players,
      matches: league._count.matches,
      url: `/dashboard/draft/${league.id}`,
      debug: {
        modoDeResultado: league.resultMode,
        caixaInicial: league.startingBudget,
        cobraSalario: league.paySalaries,
        leilao: league.auctionsEnabled
          ? `${league.auctionHours}h, +${league.auctionMinIncrementPercent}% por lance, prorroga ${league.auctionAntiSnipeMinutes} min`
          : 'desligado',
        leiloesAbertos: openAuctions,
        rodadas: `${league.currentRound}/${league.totalRounds}`,
        partidasEncerradas: playedMatches,
        mercadoAberto: league.transferWindowOpen,
        folhaTotalPorRodada: wages._sum.salary ?? 0,
        dinheiroPorTipo: Object.fromEntries(entries.map((row) => [row.type, row._sum.amount ?? 0])),
        caixaDosElencos: rosters.map(
          (roster) => `${roster.name}: ${roster.budget} (entrou ${roster.earned}, saiu ${roster.spent}), ${roster.points} pts`,
        ),
        seuElenco: rosters[0]?.name ?? 'nenhum',
        timesVagos: vacantCount,
        artilheiro: topScorer
          ? `${topScorer.name}, ${topScorer.goals} gol(s), ${topScorer.assists} assist., nota ${topScorer.rating ?? '-'}`
          : 'ninguém marcou ainda',
      },
    };
  }
}

function labelFor(format: TournamentFormat): string {
  if (format === TournamentFormat.SINGLE_ELIMINATION) return 'Elim. simples';
  if (format === TournamentFormat.DOUBLE_ELIMINATION) return 'Elim. dupla';
  if (format === TournamentFormat.ROUND_ROBIN) return 'Pontos corridos';
  return 'Grupos + mata-mata';
}

function demoPlayerName(index: number): string {
  const first = DEMO_FIRST_NAMES[index % DEMO_FIRST_NAMES.length];
  const last = DEMO_LAST_NAMES[Math.floor(index / DEMO_FIRST_NAMES.length) % DEMO_LAST_NAMES.length];
  return `${first} ${last} ${index + 1}`;
}
