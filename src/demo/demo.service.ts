import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  DraftLeagueStatus,
  Role,
  TournamentFormat,
  TournamentMatchStatus,
  TournamentStatus,
} from '@prisma/client';
import { Actor } from '../common/actor.service';
import { DraftPickService } from '../draft/draft-pick.service';
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
  ) {}

  async buildTournament(dto: BuildDemoTournamentDto, actor: Actor) {
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
    if (dto.stage === 'STARTED') {
      return this.tournamentSummary(tournament.id, 'Chaveamento gerado e pronto para jogar.');
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
    const rosterCount = dto.rosterCount ?? 4;
    const rosterSize = dto.rosterSize ?? 5;
    const poolSize = Math.max(rosterCount * rosterSize + 10, 30);

    const league = await this.prisma.draftLeague.create({
      data: {
        name: `${DEMO_PREFIX} Liga Draft ${rosterCount} elencos`,
        description: 'Liga de demonstração criada pelo painel de administração. Pode apagar à vontade.',
        rosterSize,
        pickSeconds: 3600,
        coinsWin: 0,
        coinsDraw: 0,
        coinsLoss: 0,
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
        price: 80 + ((index * 13) % 320),
      })),
    });

    const managers = await this.ensureDemoUsers(rosterCount);
    for (const [index, manager] of managers.entries()) {
      await this.prisma.draftRoster.create({
        data: {
          leagueId: league.id,
          userId: manager.id,
          name: DEMO_TEAM_NAMES[index],
          tag: DEMO_TEAM_NAMES[index].slice(0, 3).toUpperCase(),
          draftOrder: index + 1,
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

    const played = await this.simulateDraftRounds(league.id);
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

  private async simulateDraftRounds(leagueId: string): Promise<number> {
    const matches = await this.prisma.draftMatch.findMany({ where: { leagueId }, orderBy: { round: 'asc' } });
    const league = await this.prisma.draftLeague.findUniqueOrThrow({ where: { id: leagueId } });

    for (const match of matches) {
      const home = Math.floor(Math.random() * 5);
      const away = Math.floor(Math.random() * 5);
      await this.prisma.draftMatch.update({
        where: { id: match.id },
        data: { homeScore: home, awayScore: away, status: 'FINISHED', playedAt: new Date(), reportedByDiscordId: 'demo' },
      });
      await this.applyDemoRosterStats(match.homeRosterId, home, away, league.pointsWin, league.pointsDraw);
      await this.applyDemoRosterStats(match.awayRosterId, away, home, league.pointsWin, league.pointsDraw);
    }

    await this.prisma.draftLeague.update({
      where: { id: leagueId },
      data: { status: DraftLeagueStatus.FINISHED, finishedAt: new Date() },
    });
    return matches.length;
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

  private async tournamentSummary(id: string, message: string) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({
      where: { id },
      select: { id: true, name: true, format: true, status: true, _count: { select: { teams: true, matches: true } } },
    });
    return {
      message,
      id: tournament.id,
      name: tournament.name,
      format: tournament.format,
      status: tournament.status,
      teams: tournament._count.teams,
      matches: tournament._count.matches,
      url: `/dashboard/tournaments/${tournament.id}`,
    };
  }

  private async draftSummary(id: string, message: string) {
    const league = await this.prisma.draftLeague.findUniqueOrThrow({
      where: { id },
      select: { id: true, name: true, status: true, _count: { select: { rosters: true, players: true, matches: true } } },
    });
    return {
      message,
      id: league.id,
      name: league.name,
      status: league.status,
      rosters: league._count.rosters,
      players: league._count.players,
      matches: league._count.matches,
      url: `/dashboard/draft/${league.id}`,
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
