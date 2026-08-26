import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CompetitionGame,
  CompetitionRole,
  Prisma,
  TournamentFormat,
  TournamentMatchStatus,
  TournamentPhase,
  TournamentStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { Actor } from '../common/actor.service';
import { PrismaService } from '../prisma/prisma.service';
import { EaFcClubsService } from '../ea-fc-clubs/ea-fc-clubs.service';
import {
  MatchPlan,
  bracketSizeFor,
  buildDoubleElimination,
  buildGroupStage,
  buildRoundRobin,
  buildSingleElimination,
  compareStandings,
  distributeIntoGroups,
  groupName,
  groupPlanIssue,
  knockoutRoundLabel,
  tournamentPlanIssue,
} from './bracket.builder';
import { isKnockout, resolveWalkovers } from './bracket-advance';
import { craqueRanker } from './craque';
import {
  EMPTY_STANDINGS,
  clearedMatchState,
  reversedStandingsDelta,
} from './team-replacement';
import {
  AddTeamDto,
  CreateTournamentDto,
  ListTournamentsDto,
  SetSeedsDto,
  StaffDto,
  UpdateTeamDto,
  UpdateTournamentDto,
} from './dto/tournament.dto';
import { TournamentAccessService } from './tournament-access.service';

const MANAGED_STATUSES: TournamentStatus[] = [
  TournamentStatus.DRAFT,
  TournamentStatus.REGISTRATION,
];

// Espelham os defaults do schema, usados para validar o plano de grupos antes de
// o registro existir.
const DEFAULTS = { maxTeams: 8, groupCount: 2, advancePerGroup: 2, legs: 1 };

@Injectable()
export class TournamentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TournamentAccessService,
    private readonly eaClubs: EaFcClubsService,
  ) {}

  async create(dto: CreateTournamentDto, actor: Actor) {
    if (!dto.startsAt) {
      throw new BadRequestException(
        'Defina o horário de início do campeonato.',
      );
    }
    if (!dto.registrationEndsAt) {
      throw new BadRequestException('Defina quando as inscrições terminam.');
    }
    this.assertPlan(dto.format ?? TournamentFormat.SINGLE_ELIMINATION, {
      teamCount: dto.maxTeams ?? DEFAULTS.maxTeams,
      groupCount: dto.groupCount ?? DEFAULTS.groupCount,
      advancePerGroup: dto.advancePerGroup ?? DEFAULTS.advancePerGroup,
      legs: dto.legs ?? DEFAULTS.legs,
      thirdPlace: dto.thirdPlace ?? false,
    });
    this.assertWindow(
      dto.registrationEndsAt,
      dto.autoStartOnClose,
      dto.startsAt,
    );

    const slug = await this.uniqueSlug(dto.name);
    const invitedUsers = dto.invitedUsernames?.length
      ? await this.prisma.user.findMany({
          where: {
            OR: dto.invitedUsernames.map((name) => ({
              name: { equals: name, mode: 'insensitive' },
            })),
          },
          select: { id: true, name: true },
        })
      : [];
    if (invitedUsers.length !== new Set(dto.invitedUsernames ?? []).size) {
      const found = new Set(
        invitedUsers.map((user) => user.name.toLocaleLowerCase('pt-BR')),
      );
      const missing = (dto.invitedUsernames ?? []).filter(
        (name) => !found.has(name.toLocaleLowerCase('pt-BR')),
      );
      throw new BadRequestException(
        `Usuário não encontrado: ${missing.join(', ')}.`,
      );
    }
    return this.prisma.tournament.create({
      data: {
        ...this.settingsFrom(dto),
        name: dto.name,
        slug,
        createdByDiscordId: actor.discordId,
        status: TournamentStatus.REGISTRATION,
        inviteCode:
          dto.accessMode === 'INVITE_ONLY'
            ? randomBytes(24).toString('base64url')
            : null,
        staff: { create: { userId: actor.id, role: CompetitionRole.OWNER } },
        invites: {
          create: invitedUsers
            .filter((user) => user.id !== actor.id)
            .map((user) => ({ userId: user.id, invitedById: actor.id })),
        },
      },
      include: {
        staff: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
        },
      },
    });
  }

  async list(query: ListTournamentsDto, actor: Actor) {
    const where: Prisma.TournamentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.game ? { game: query.game } : {}),
      ...(actor.role === 'ADMIN'
        ? {}
        : {
            OR: [
              { accessMode: 'PUBLIC' as const },
              { staff: { some: { userId: actor.id } } },
              { teams: { some: { members: { some: { userId: actor.id } } } } },
              { invites: { some: { userId: actor.id } } },
            ],
          }),
    };

    const [items, total] = await Promise.all([
      this.prisma.tournament.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: query.take ?? 20,
        skip: query.skip ?? 0,
        include: {
          _count: { select: { teams: true, matches: true } },
          staff: {
            where: { role: CompetitionRole.OWNER },
            include: {
              user: { select: { id: true, name: true, avatar: true } },
            },
          },
        },
      }),
      this.prisma.tournament.count({ where }),
    ]);

    return {
      total,
      items: items.map((tournament) => ({
        ...tournament,
        owner: tournament.staff[0]?.user ?? null,
        teamCount: tournament._count.teams,
        matchCount: tournament._count.matches,
        staff: undefined,
        _count: undefined,
      })),
    };
  }

  async detail(id: string, actor: Actor) {
    const access = await this.access.requireView(id, actor);
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        teams: {
          orderBy: [{ points: 'desc' }, { seed: 'asc' }, { name: 'asc' }],
          include: {
            members: {
              include: {
                user: { select: { id: true, name: true, avatar: true } },
              },
            },
          },
        },
        groups: { orderBy: { order: 'asc' } },
        staff: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
        },
        matches: {
          omit: { eaRaw: true },
          orderBy: [
            { phase: 'asc' },
            { round: 'asc' },
            { position: 'asc' },
            { leg: 'asc' },
          ],
          include: {
            homeTeam: {
              select: {
                id: true,
                name: true,
                tag: true,
                logoUrl: true,
                seed: true,
              },
            },
            awayTeam: {
              select: {
                id: true,
                name: true,
                tag: true,
                logoUrl: true,
                seed: true,
              },
            },
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
                aiProvider: true,
                aiModel: true,
                submittedByDiscordId: true,
                reviewNote: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    if (!tournament) throw new NotFoundException('Campeonato não encontrado.');

    return {
      ...tournament,
      access,
      standings: this.buildStandings(tournament.teams, tournament.groups),
    };
  }

  async update(id: string, dto: UpdateTournamentDto, actor: Actor) {
    await this.access.requireManage(id, actor);
    const tournament = await this.access.requireExists(id);

    const settings = this.settingsFrom(dto);
    if (
      tournament.status === TournamentStatus.RUNNING ||
      tournament.status === TournamentStatus.FINISHED
    ) {
      for (const locked of [
        'format',
        'maxTeams',
        'groupCount',
        'advancePerGroup',
        'legs',
        'thirdPlace',
      ] as const) {
        delete settings[locked];
      }
    }

    // Só revalida quando a edição mexe no plano: durante as inscrições o total de
    // times ainda muda e nada mais precisa ficar preso a isso.
    const planKeys = [
      'format',
      'maxTeams',
      'groupCount',
      'advancePerGroup',
      'legs',
      'thirdPlace',
    ] as const;
    if (planKeys.some((key) => key in settings)) {
      this.assertPlan(
        (settings.format as TournamentFormat) ?? tournament.format,
        {
          teamCount: (settings.maxTeams as number) ?? tournament.maxTeams,
          groupCount: (settings.groupCount as number) ?? tournament.groupCount,
          advancePerGroup:
            (settings.advancePerGroup as number) ?? tournament.advancePerGroup,
          legs: (settings.legs as number) ?? tournament.legs,
          thirdPlace: (settings.thirdPlace as boolean) ?? tournament.thirdPlace,
        },
      );
    }
    this.assertWindow(
      dto.registrationEndsAt ?? tournament.registrationEndsAt ?? undefined,
      dto.autoStartOnClose ?? tournament.autoStartOnClose,
      dto.startsAt ?? tournament.startsAt ?? undefined,
    );

    return this.prisma.tournament.update({
      where: { id },
      data: {
        ...settings,
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.accessMode === 'INVITE_ONLY' &&
        tournament.accessMode !== 'INVITE_ONLY'
          ? { inviteCode: randomBytes(24).toString('base64url') }
          : {}),
        ...(dto.accessMode === 'PUBLIC' ? { inviteCode: null } : {}),
      },
    });
  }

  async remove(id: string, actor: Actor) {
    await this.access.requireManage(id, actor);
    await this.prisma.tournament.delete({ where: { id } });
    return { deleted: true };
  }

  async addTeam(id: string, dto: AddTeamDto, actor: Actor) {
    const tournament = await this.access.requireExists(id);
    const access = await this.access.of(id, actor);
    if (!access.canView)
      throw new ForbiddenException(
        'Este campeonato é fechado e exige convite.',
      );

    if (!access.canModerate) {
      if (tournament.status !== TournamentStatus.REGISTRATION) {
        throw new ForbiddenException(
          'As inscrições deste campeonato estão fechadas.',
        );
      }
      if (access.teamIds.length > 0) {
        throw new BadRequestException(
          'Você já tem um time inscrito neste campeonato.',
        );
      }
    }
    if (!MANAGED_STATUSES.includes(tournament.status)) {
      throw new BadRequestException(
        'O campeonato já começou, não dá mais para inscrever times.',
      );
    }

    if (
      tournament.game === CompetitionGame.EA_FC &&
      !access.canModerate &&
      !dto.eaClubId
    ) {
      throw new BadRequestException(
        'Valide o clube na EA antes de entrar no campeonato.',
      );
    }
    const eaClub = dto.eaClubId
      ? await this.eaClubs.requireTournamentClub(
          dto.eaClubId,
          dto.eaPlatform ?? 'common-gen5',
        )
      : null;

    const teamCount = await this.prisma.tournamentTeam.count({
      where: { tournamentId: id },
    });
    if (teamCount >= tournament.maxTeams) {
      throw new BadRequestException(
        `O campeonato já atingiu o limite de ${tournament.maxTeams} times.`,
      );
    }

    const captainUser =
      access.canModerate && dto.captainUsername
        ? await this.prisma.user.findFirst({
            where: {
              name: { equals: dto.captainUsername, mode: 'insensitive' },
            },
            select: { id: true, discordId: true },
          })
        : null;
    if (access.canModerate && dto.captainUsername && !captainUser) {
      throw new BadRequestException(
        'Não encontramos um usuário com esse nome exato.',
      );
    }
    const memberIds = access.canModerate
      ? captainUser
        ? [
            captainUser.id,
            ...(dto.memberIds ?? []).filter((id) => id !== captainUser.id),
          ]
        : (dto.memberIds ?? [])
      : [actor.id];
    if (memberIds.length === 0) {
      throw new BadRequestException(
        'Todo time precisa ter um usuário responsável vinculado.',
      );
    }
    if (new Set(memberIds).size !== memberIds.length) {
      throw new BadRequestException(
        'O mesmo jogador apareceu duas vezes na lista do time.',
      );
    }
    if (memberIds.length > tournament.teamSize) {
      throw new BadRequestException(
        `Este campeonato é ${tournament.teamSize} por time.`,
      );
    }
    const existingMembers = await this.prisma.user.count({
      where: { id: { in: memberIds } },
    });
    if (existingMembers !== memberIds.length) {
      throw new BadRequestException('Algum jogador da lista não existe.');
    }
    const alreadyRegistered = await this.prisma.tournamentTeamMember.findFirst({
      where: { userId: { in: memberIds }, team: { tournamentId: id } },
      include: { user: { select: { name: true } } },
    });
    if (alreadyRegistered) {
      throw new BadRequestException(
        `${alreadyRegistered.user.name} já está associado a outro time neste campeonato.`,
      );
    }

    return this.prisma.tournamentTeam.create({
      data: {
        tournamentId: id,
        name: eaClub?.name ?? dto.name,
        tag: dto.tag,
        logoUrl: dto.logoUrl,
        eaClubId: dto.eaClubId,
        eaPlatform: eaClub?.platform ?? dto.eaPlatform,
        seed: teamCount + 1,
        ownerDiscordId: captainUser?.discordId ?? actor.discordId,
        members: {
          create: memberIds.map((userId, index) => ({
            userId,
            captain: index === 0,
          })),
        },
      },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
        },
      },
    });
  }

  async validateEaClub(
    id: string,
    name: string,
    platform: 'common-gen5',
    actor: Actor,
  ) {
    const tournament = await this.access.requireExists(id);
    await this.access.requireView(id, actor);
    if (tournament.game !== CompetitionGame.EA_FC) {
      throw new BadRequestException('Este campeonato não é de EA Sports FC.');
    }
    if (!MANAGED_STATUSES.includes(tournament.status)) {
      throw new BadRequestException(
        'As inscrições deste campeonato já terminaram.',
      );
    }
    const club = await this.eaClubs.resolveTournamentClub(name, platform);
    const alreadyEntered = await this.prisma.tournamentTeam.findFirst({
      where: { tournamentId: id, eaClubId: club.externalClubId },
      select: { id: true },
    });
    if (alreadyEntered)
      throw new BadRequestException(
        'Este clube da EA já está inscrito no campeonato.',
      );
    return club;
  }

  async eaStats(id: string, actor: Actor) {
    await this.access.requireView(id, actor);
    const stats = await this.prisma.tournamentEaPlayerStat.findMany({
      where: { match: { tournamentId: id } },
      include: { match: { select: { playedAt: true } } },
    });
    const teams = await this.prisma.tournamentTeam.findMany({
      where: { tournamentId: id },
      select: { id: true, name: true, logoUrl: true },
    });
    const teamById = new Map(teams.map((team) => [team.id, team]));
    const matchesByTeam = new Map<string, Set<string>>();
    const players = new Map<
      string,
      {
        playerName: string;
        externalPlayerId: string | null;
        teamId: string;
        games: Set<string>;
        goals: number;
        assists: number;
        ratingTotal: number;
        ratedGames: number;
        mvps: number;
        tags: Set<string>;
        passesAttempted: number;
        passesCompleted: number;
        tacklesAttempted: number;
        tacklesCompleted: number;
        shots: number;
        saves: number;
        yellowCards: number;
        redCards: number;
      }
    >();
    for (const stat of stats) {
      const teamMatches = matchesByTeam.get(stat.teamId) ?? new Set<string>();
      teamMatches.add(stat.matchId);
      matchesByTeam.set(stat.teamId, teamMatches);
      const key = `${stat.teamId}:${stat.externalPlayerId ?? stat.playerName.normalize('NFKC').toLocaleLowerCase('pt-BR')}`;
      const row = players.get(key) ?? {
        playerName: stat.playerName,
        externalPlayerId: stat.externalPlayerId,
        teamId: stat.teamId,
        games: new Set<string>(),
        goals: 0,
        assists: 0,
        ratingTotal: 0,
        ratedGames: 0,
        mvps: 0,
        tags: new Set<string>(),
        passesAttempted: 0,
        passesCompleted: 0,
        tacklesAttempted: 0,
        tacklesCompleted: 0,
        shots: 0,
        saves: 0,
        yellowCards: 0,
        redCards: 0,
      };
      row.games.add(stat.matchId);
      row.goals += stat.goals;
      row.assists += stat.assists;
      row.ratingTotal += stat.rating ?? 0;
      row.ratedGames += stat.rating === null ? 0 : 1;
      row.mvps += stat.manOfTheMatch ? 1 : 0;
      row.passesAttempted += stat.passesAttempted ?? 0;
      row.passesCompleted += stat.passesCompleted ?? 0;
      row.tacklesAttempted += stat.tacklesAttempted ?? 0;
      row.tacklesCompleted += stat.tacklesCompleted ?? 0;
      row.shots += stat.shots ?? 0;
      row.saves += stat.saves ?? 0;
      row.yellowCards += stat.yellowCards ?? 0;
      row.redCards += stat.redCards ?? 0;
      stat.tags.forEach((tag) => row.tags.add(tag));
      players.set(key, row);
    }
    return Array.from(players.values())
      .map((player) => ({
        playerName: player.playerName,
        externalPlayerId: player.externalPlayerId,
        team: teamById.get(player.teamId) ?? null,
        appearances: player.games.size,
        ratedAppearances: player.ratedGames,
        teamMatches:
          matchesByTeam.get(player.teamId)?.size ?? player.games.size,
        goals: player.goals,
        assists: player.assists,
        goalContributions: player.goals + player.assists,
        averageRating: player.ratedGames
          ? player.ratingTotal / player.ratedGames
          : null,
        mvps: player.mvps,
        passesAttempted: player.passesAttempted,
        passesCompleted: player.passesCompleted,
        passAccuracy: player.passesAttempted
          ? (player.passesCompleted / player.passesAttempted) * 100
          : null,
        tacklesAttempted: player.tacklesAttempted,
        tacklesCompleted: player.tacklesCompleted,
        tackleSuccess: player.tacklesAttempted
          ? (player.tacklesCompleted / player.tacklesAttempted) * 100
          : null,
        shots: player.shots,
        saves: player.saves,
        yellowCards: player.yellowCards,
        redCards: player.redCards,
        tags: Array.from(player.tags),
      }))
      .sort(
        (a, b) =>
          b.goalContributions - a.goalContributions || b.goals - a.goals,
      );
  }

  async eaAwards(id: string, actor: Actor) {
    await this.access.requireView(id, actor);
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      select: {
        name: true,
        status: true,
        championTeamId: true,
        teams: {
          select: { id: true, name: true, logoUrl: true },
        },
      },
    });
    if (!tournament) throw new NotFoundException('Campeonato não encontrado.');

    const players = await this.eaStats(id, actor);
    const rank = (
      pool: typeof players,
      score: (player: (typeof players)[number]) => number,
    ) =>
      [...pool].sort(
        (a, b) =>
          score(b) - score(a) ||
          b.appearances - a.appearances ||
          b.mvps - a.mvps ||
          b.goalContributions - a.goalContributions ||
          a.playerName.localeCompare(b.playerName, 'pt-BR'),
      )[0];

    const ratedPlayers = players.filter(
      (player) => player.averageRating !== null && player.ratedAppearances > 0,
    );
    const totalRatedAppearances = ratedPlayers.reduce(
      (total, player) => total + player.ratedAppearances,
      0,
    );
    const tournamentAverageRating =
      totalRatedAppearances > 0
        ? ratedPlayers.reduce(
            (total, player) =>
              total + (player.averageRating ?? 0) * player.ratedAppearances,
            0,
          ) / totalRatedAppearances
        : 0;
    const mostTeamMatches = Math.max(
      ...players.map((player) => player.teamMatches),
      0,
    );
    const absoluteMinimum = Math.min(3, mostTeamMatches);
    const requiredAppearances = (player: (typeof players)[number]) =>
      Math.max(absoluteMinimum, Math.ceil(player.teamMatches * 0.7));
    const eligibleCraques = ratedPlayers.filter(
      (player) =>
        player.appearances >= requiredAppearances(player) &&
        player.ratedAppearances >= requiredAppearances(player),
    );
    // O índice do craque olha a ficha inteira, não só a nota: gols, assistências,
    // desarmes, defesas, passe e presença entram normalizados pelo melhor do
    // próprio campeonato.
    const scoreCraque = craqueRanker(eligibleCraques, tournamentAverageRating);
    const craqueScore = (player: (typeof players)[number]) => scoreCraque(player).score;
    const craque = rank(eligibleCraques, craqueScore);
    const eligibleCraqueSet = new Set(eligibleCraques);
    const rankedPlayers = players
      .map((player) => ({
        ...player,
        craqueScore: eligibleCraqueSet.has(player) ? craqueScore(player) : null,
      }))
      .sort(
        (a, b) =>
          (b.craqueScore ?? Number.NEGATIVE_INFINITY) -
            (a.craqueScore ?? Number.NEGATIVE_INFINITY) ||
          b.appearances - a.appearances ||
          b.mvps - a.mvps ||
          b.goalContributions - a.goalContributions ||
          a.playerName.localeCompare(b.playerName, 'pt-BR'),
      );
    const definitions = [
      {
        key: 'ARTILHEIRO',
        title: 'Artilheiro',
        subtitle: 'Maior goleador',
        player: rank(players, (player) => player.goals),
        value: (player: (typeof players)[number]) => `${player.goals} gols`,
      },
      {
        key: 'GARCOM',
        title: 'Garçom',
        subtitle: 'Líder de assistências',
        player: rank(players, (player) => player.assists),
        value: (player: (typeof players)[number]) =>
          `${player.assists} assistências`,
      },
      {
        key: 'CRAQUE',
        title: 'Craque do Campeonato',
        subtitle: 'Nota, produção, defesa e presença',
        player: craque,
        value: (player: (typeof players)[number]) =>
          `Índice ${craqueScore(player).toFixed(2).replace('.', ',')}`,
      },
      {
        key: 'MAESTRO',
        title: 'Maestro',
        subtitle: 'Mais passes certos',
        player: rank(players, (player) => player.passesCompleted),
        value: (player: (typeof players)[number]) =>
          `${player.passesCompleted} passes · ${player.passAccuracy?.toFixed(0) ?? 0}%`,
      },
      {
        key: 'XERIFE',
        title: 'Xerife',
        subtitle: 'Mais desarmes certos',
        player: rank(players, (player) => player.tacklesCompleted),
        value: (player: (typeof players)[number]) =>
          `${player.tacklesCompleted} desarmes · ${player.tackleSuccess?.toFixed(0) ?? 0}%`,
      },
      {
        key: 'MURALHA',
        title: 'Muralha',
        subtitle: 'Maior número de defesas',
        player: rank(players, (player) => player.saves),
        value: (player: (typeof players)[number]) => `${player.saves} defesas`,
      },
    ];
    const champion = tournament.championTeamId
      ? tournament.teams.find((team) => team.id === tournament.championTeamId)
      : null;
    const championPlayers = champion
      ? players
          .filter((player) => player.team?.id === champion.id)
          .sort(
            (a, b) =>
              b.appearances - a.appearances ||
              a.playerName.localeCompare(b.playerName, 'pt-BR'),
          )
          .map((player) => ({
            playerName: player.playerName,
            appearances: player.appearances,
          }))
      : [];

    return {
      source: 'EA_API',
      finalized: tournament.status === TournamentStatus.FINISHED,
      players: rankedPlayers,
      championCard:
        tournament.status === TournamentStatus.FINISHED && champion
          ? {
              tournamentName: tournament.name,
              team: champion,
              players: championPlayers,
            }
          : null,
      criteria: {
        craqueMinimumAppearances: absoluteMinimum,
        craqueMinimumShare: 0.7,
        craquePriorGames: 2,
        craqueTournamentAverageRating: tournamentAverageRating,
        craqueFormula:
          'nota ajustada + produção ofensiva*1.4 + MVP*0.65 + defesa*0.55 + finalizações*0.35 + passe*0.35 + presença*0.3',
        tieBreakers: ['appearances', 'mvps', 'goalContributions', 'playerName'],
      },
      awards:
        tournament.status === TournamentStatus.FINISHED
          ? definitions
              .filter((award) => award.player)
              .map((award) => ({
                key: award.key,
                title: award.title,
                subtitle: award.subtitle,
                player: award.player!,
                value: award.value(award.player!),
              }))
          : [],
    };
  }

  async joinByInvite(code: string, actor: Actor) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { inviteCode: code },
    });
    if (!tournament || tournament.accessMode !== 'INVITE_ONLY') {
      throw new NotFoundException('Convite inválido ou expirado.');
    }
    await this.prisma.tournamentInvite.upsert({
      where: {
        tournamentId_userId: { tournamentId: tournament.id, userId: actor.id },
      },
      update: { acceptedAt: new Date() },
      create: {
        tournamentId: tournament.id,
        userId: actor.id,
        invitedById: null,
        acceptedAt: new Date(),
      },
    });
    return { tournamentId: tournament.id };
  }

  async updateTeam(
    id: string,
    teamId: string,
    dto: UpdateTeamDto,
    actor: Actor,
  ) {
    const team = await this.requireTeam(id, teamId);
    const access = await this.access.of(id, actor);
    const isTeamOwner = access.teamIds.includes(team.id);
    if (!access.canModerate && !isTeamOwner) {
      throw new ForbiddenException('Você não pode editar este time.');
    }

    if (dto.eaClubId !== undefined || dto.eaPlatform !== undefined) {
      throw new BadRequestException(
        'O vínculo com o clube da EA é definido na inscrição e não pode ser alterado.',
      );
    }

    return this.prisma.tournamentTeam.update({
      where: { id: teamId },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.tag !== undefined ? { tag: dto.tag } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
        ...(dto.seed !== undefined && access.canModerate
          ? { seed: dto.seed }
          : {}),
      },
    });
  }

  async replaceTeamEaClub(
    id: string,
    teamId: string,
    name: string,
    platform: 'common-gen5',
    actor: Actor,
  ) {
    const tournament = await this.access.requireExists(id);
    await this.access.requireModerate(id, actor);
    const team = await this.requireTeam(id, teamId);
    if (tournament.game !== CompetitionGame.EA_FC) {
      throw new BadRequestException('Este campeonato não é de EA Sports FC.');
    }
    if (tournament.status === TournamentStatus.FINISHED || tournament.status === TournamentStatus.CANCELLED) {
      throw new BadRequestException('Não dá para substituir um time depois que o campeonato foi encerrado.');
    }

    // O mata-mata decidido trava a troca: zerar as partidas deste time desfaz a
    // classificação que já colocou (ou tirou) outros times da chave, e um
    // resultado de mata-mata já jogado não teria como voltar para o lugar.
    const decidedKnockout = await this.prisma.tournamentMatch.findFirst({
      where: {
        tournamentId: id,
        phase: { notIn: [TournamentPhase.GROUP, TournamentPhase.LEAGUE] },
        OR: [
          { status: { in: [TournamentMatchStatus.FINISHED, TournamentMatchStatus.WALKOVER] } },
          { homeScore: { not: null } },
          { awayScore: { not: null } },
          { winnerTeamId: { not: null } },
        ],
      },
      select: { id: true },
    });
    if (decidedKnockout) {
      throw new BadRequestException('O mata-mata já tem resultado. Não dá para substituir um clube depois que a chave começou a ser decidida.');
    }

    const club = await this.eaClubs.resolveTournamentClub(name, platform);
    const duplicate = await this.prisma.tournamentTeam.findFirst({
      where: {
        tournamentId: id,
        id: { not: team.id },
        OR: [
          { eaClubId: club.externalClubId },
          { name: { equals: club.name, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException('Este clube da EA já está inscrito no campeonato.');
    }

    const previousName = team.name;
    const eaCheckMessage = `Clube substituído por ${club.name}. A partida voltou a valer e aguarda um novo resultado.`;

    return this.prisma.$transaction(
      async (tx) => {
        const matches = await tx.tournamentMatch.findMany({
          where: { tournamentId: id, OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }] },
        });

        let clearedResults = 0;
        for (const match of matches) {
          const settled =
            (match.status === TournamentMatchStatus.FINISHED || match.status === TournamentMatchStatus.WALKOVER) &&
            match.homeScore !== null &&
            match.awayScore !== null;

          // O adversário devolve à tabela só o que ganhou nesta partida: o resto
          // da campanha dele continua valendo.
          if (settled && !isKnockout(match.phase)) {
            const teamIsHome = match.homeTeamId === team.id;
            const opponentId = teamIsHome ? match.awayTeamId : match.homeTeamId;
            if (opponentId) {
              await tx.tournamentTeam.update({
                where: { id: opponentId },
                data: reversedStandingsDelta(
                  tournament,
                  teamIsHome ? match.awayScore! : match.homeScore!,
                  teamIsHome ? match.homeScore! : match.awayScore!,
                ),
              });
            }
          }

          await tx.tournamentEaPlayerStat.deleteMany({ where: { matchId: match.id } });
          await tx.matchProof.deleteMany({ where: { matchId: match.id } });
          await tx.tournamentMatch.update({
            where: { id: match.id },
            data: clearedMatchState(match, eaCheckMessage),
          });

          if (settled) {
            clearedResults++;
            await tx.tournamentMatchMessage.create({
              data: {
                matchId: match.id,
                teamId: null,
                system: true,
                body: `A organização substituiu ${previousName} por ${club.name}. O resultado anterior foi zerado e a partida precisa ser jogada de novo.`,
              },
            });
          }
        }

        // Grupo com partida zerada volta a ter fase de pontos em aberto, então a
        // classificação publicada não vale mais: a chave é limpa e refeita
        // sozinha quando o último jogo do grupo for encerrado.
        const hasGroups = await tx.tournamentGroup.count({ where: { tournamentId: id } });
        if (hasGroups > 0 && clearedResults > 0) {
          await tx.tournamentMatch.updateMany({
            where: { tournamentId: id, phase: { notIn: [TournamentPhase.GROUP, TournamentPhase.LEAGUE] } },
            data: {
              homeTeamId: null,
              awayTeamId: null,
              status: TournamentMatchStatus.PENDING,
              readyAt: null,
              homeReadyAt: null,
              awayReadyAt: null,
              scheduledAt: null,
              scheduleProposedAt: null,
              scheduleProposedByTeamId: null,
            },
          });
          await tx.tournamentTeam.updateMany({ where: { tournamentId: id }, data: { eliminated: false } });
        }

        return tx.tournamentTeam.update({
          where: { id: team.id },
          data: {
            name: club.name,
            tag: null,
            logoUrl: null,
            eaClubId: club.externalClubId,
            eaPlatform: club.platform,
            ...EMPTY_STANDINGS,
          },
          include: {
            members: {
              include: { user: { select: { id: true, name: true, avatar: true } } },
            },
          },
        });
      },
      { timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async removeTeam(id: string, teamId: string, actor: Actor) {
    const tournament = await this.access.requireExists(id);
    const team = await this.requireTeam(id, teamId);
    const access = await this.access.of(id, actor);

    if (!access.canModerate && !access.teamIds.includes(team.id)) {
      throw new ForbiddenException('Você não pode remover este time.');
    }
    if (!MANAGED_STATUSES.includes(tournament.status)) {
      throw new BadRequestException(
        'O campeonato já começou. Use W.O. em vez de remover o time.',
      );
    }

    await this.prisma.tournamentTeam.delete({ where: { id: teamId } });
    return { deleted: true };
  }

  async setSeeds(id: string, dto: SetSeedsDto, actor: Actor) {
    await this.access.requireModerate(id, actor);
    const tournament = await this.access.requireExists(id);
    if (!MANAGED_STATUSES.includes(tournament.status)) {
      throw new BadRequestException(
        'Não dá para mudar o chaveamento com o campeonato em andamento.',
      );
    }

    const teamIds = dto.seeds.map((entry) => entry.teamId);
    if (new Set(teamIds).size !== teamIds.length) {
      throw new BadRequestException(
        'Cada time deve aparecer apenas uma vez no chaveamento.',
      );
    }
    const scopedTeams = await this.prisma.tournamentTeam.findMany({
      where: { id: { in: teamIds }, tournamentId: id },
      select: { id: true },
    });
    if (scopedTeams.length !== teamIds.length) {
      throw new BadRequestException(
        'Um ou mais times nÃ£o pertencem a este campeonato.',
      );
    }

    await this.prisma.$transaction(
      dto.seeds.map((entry) =>
        this.prisma.tournamentTeam.update({
          where: { id: entry.teamId },
          data: { seed: entry.seed },
        }),
      ),
    );
    return this.prisma.tournamentTeam.findMany({
      where: { tournamentId: id },
      orderBy: { seed: 'asc' },
    });
  }

  async setStaff(id: string, dto: StaffDto, actor: Actor) {
    await this.access.requireManage(id, actor);
    if (dto.role === CompetitionRole.OWNER) {
      throw new BadRequestException(
        'Use a transferência de propriedade para trocar o dono.',
      );
    }
    return this.prisma.tournamentStaff.upsert({
      where: { tournamentId_userId: { tournamentId: id, userId: dto.userId } },
      update: { role: dto.role, addedByUserId: actor.id },
      create: {
        tournamentId: id,
        userId: dto.userId,
        role: dto.role,
        addedByUserId: actor.id,
      },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
  }

  async removeStaff(id: string, userId: number, actor: Actor) {
    await this.access.requireManage(id, actor);
    const staff = await this.prisma.tournamentStaff.findUnique({
      where: { tournamentId_userId: { tournamentId: id, userId } },
    });
    if (!staff)
      throw new NotFoundException('Esse usuário não faz parte da organização.');
    if (staff.role === CompetitionRole.OWNER) {
      throw new BadRequestException(
        'O dono do campeonato não pode ser removido.',
      );
    }
    await this.prisma.tournamentStaff.delete({ where: { id: staff.id } });
    return { removed: true };
  }

  async transferOwnership(id: string, userId: number, actor: Actor) {
    await this.access.requireManage(id, actor);
    if (userId === actor.id)
      throw new BadRequestException('Você já é o dono deste campeonato.');

    return this.prisma.$transaction(async (tx) => {
      await tx.tournamentStaff.updateMany({
        where: { tournamentId: id, role: CompetitionRole.OWNER },
        data: { role: CompetitionRole.MODERATOR },
      });
      return tx.tournamentStaff.upsert({
        where: { tournamentId_userId: { tournamentId: id, userId } },
        update: { role: CompetitionRole.OWNER },
        create: {
          tournamentId: id,
          userId,
          role: CompetitionRole.OWNER,
          addedByUserId: actor.id,
        },
        include: { user: { select: { id: true, name: true, avatar: true } } },
      });
    });
  }

  async start(id: string, actor: Actor) {
    await this.access.requireManage(id, actor);
    const tournament = await this.access.requireExists(id);
    if (!MANAGED_STATUSES.includes(tournament.status)) {
      throw new BadRequestException('Este campeonato já foi iniciado.');
    }

    const teams = await this.prisma.tournamentTeam.findMany({
      where: { tournamentId: id },
      orderBy: [{ seed: 'asc' }, { createdAt: 'asc' }],
    });
    this.assertStartable(
      tournament.format,
      teams.length,
      tournament.groupCount,
      tournament.advancePerGroup,
      tournament.legs,
      tournament.thirdPlace,
    );

    return this.prisma.$transaction(
      async (tx) => {
        await tx.tournamentMatch.deleteMany({ where: { tournamentId: id } });
        await tx.tournamentGroup.deleteMany({ where: { tournamentId: id } });

        for (const [index, team] of teams.entries()) {
          await tx.tournamentTeam.update({
            where: { id: team.id },
            data: {
              seed: index + 1,
              eliminated: false,
              played: 0,
              wins: 0,
              draws: 0,
              losses: 0,
              scoreFor: 0,
              scoreAgainst: 0,
              points: 0,
              groupId: null,
            },
          });
        }

        const teamIdsBySeed = teams.map((team) => team.id);
        const plans =
          tournament.format === TournamentFormat.GROUPS_KNOCKOUT
            ? await this.planGroupStage(
                tx,
                id,
                teamIdsBySeed,
                tournament.groupCount,
                tournament.advancePerGroup,
                tournament.legs,
                tournament.thirdPlace,
              )
            : this.planFor(
                tournament.format,
                teams.length,
                tournament.legs,
                tournament.thirdPlace,
              );

        const groups = await tx.tournamentGroup.findMany({
          where: { tournamentId: id },
          orderBy: { order: 'asc' },
        });
        const groupTeams = new Map<number, string[]>();
        for (const group of groups) {
          const members = await tx.tournamentTeam.findMany({
            where: { groupId: group.id },
            orderBy: { seed: 'asc' },
            select: { id: true },
          });
          groupTeams.set(
            group.order,
            members.map((member) => member.id),
          );
        }

        const created = new Map<string, string>();
        for (const plan of plans) {
          const pool =
            plan.groupOrder !== undefined
              ? (groupTeams.get(plan.groupOrder) ?? [])
              : teamIdsBySeed;
          const homeTeamId = this.resolveTeam(
            plan.homeSeed,
            plan.homeIndex,
            pool,
            teamIdsBySeed,
          );
          const awayTeamId = this.resolveTeam(
            plan.awaySeed,
            plan.awayIndex,
            pool,
            teamIdsBySeed,
          );

          const match = await tx.tournamentMatch.create({
            data: {
              tournamentId: id,
              groupId:
                plan.groupOrder !== undefined
                  ? groups[plan.groupOrder]?.id
                  : null,
              phase: plan.phase,
              round: plan.round,
              position: plan.position,
              leg: plan.leg,
              label: plan.label,
              homeTeamId,
              awayTeamId,
              status:
                homeTeamId && awayTeamId
                  ? TournamentMatchStatus.READY
                  : TournamentMatchStatus.PENDING,
              readyAt: homeTeamId && awayTeamId ? new Date() : null,
            },
          });
          created.set(planKey(plan), match.id);
        }

        for (const plan of plans) {
          const data: Prisma.TournamentMatchUpdateInput = {};
          if (plan.winnerTo) {
            const target = created.get(refKey(plan.winnerTo));
            if (target) {
              data.nextMatch = { connect: { id: target } };
              data.nextMatchSlot = plan.winnerTo.slot;
            }
          }
          if (plan.loserTo) {
            const target = created.get(refKey(plan.loserTo));
            if (target) {
              data.loserNextMatch = { connect: { id: target } };
              data.loserNextMatchSlot = plan.loserTo.slot;
            }
          }
          if (Object.keys(data).length > 0) {
            await tx.tournamentMatch.update({
              where: { id: created.get(planKey(plan))! },
              data,
            });
          }
        }

        await resolveWalkovers(tx, id);

        return tx.tournament.update({
          where: { id },
          data: {
            status: TournamentStatus.RUNNING,
            startsAt: tournament.startsAt ?? new Date(),
          },
        });
      },
      { timeout: 30000 },
    );
  }

  async scheduleMatch(
    tournamentId: string,
    matchId: string,
    scheduledAt: Date,
  ) {
    const match = await this.prisma.tournamentMatch.findFirst({
      where: { id: matchId, tournamentId },
    });
    if (!match)
      throw new NotFoundException('Partida não encontrada neste campeonato.');
    return this.prisma.tournamentMatch.update({
      where: { id: matchId },
      data: { scheduledAt },
    });
  }

  private resolveTeam(
    seed: number | undefined,
    index: number | undefined,
    pool: string[],
    allBySeed: string[],
  ): string | null {
    if (seed !== undefined) return allBySeed[seed - 1] ?? null;
    if (index !== undefined) return pool[index] ?? null;
    return null;
  }

  private planFor(
    format: TournamentFormat,
    teamCount: number,
    legs: number,
    thirdPlace: boolean,
  ): MatchPlan[] {
    if (format === TournamentFormat.SINGLE_ELIMINATION)
      return buildSingleElimination(teamCount, thirdPlace);
    if (format === TournamentFormat.DOUBLE_ELIMINATION)
      return buildDoubleElimination(teamCount);
    return buildRoundRobin(teamCount, legs, TournamentPhase.LEAGUE);
  }

  private async planGroupStage(
    tx: Prisma.TransactionClient,
    tournamentId: string,
    teamIdsBySeed: string[],
    groupCount: number,
    advancePerGroup: number,
    legs: number,
    thirdPlace: boolean,
  ): Promise<MatchPlan[]> {
    const distribution = distributeIntoGroups(teamIdsBySeed.length, groupCount);

    for (const [order, seedIndexes] of distribution.entries()) {
      const group = await tx.tournamentGroup.create({
        data: { tournamentId, order, name: groupName(order) },
      });
      await tx.tournamentTeam.updateMany({
        where: {
          id: { in: seedIndexes.map((seedIndex) => teamIdsBySeed[seedIndex]) },
        },
        data: { groupId: group.id },
      });
    }

    const groupPlans = buildGroupStage(
      distribution.map((seedIndexes) => seedIndexes.length),
      legs,
    );

    const qualifiers = distribution.reduce(
      (total, seedIndexes) =>
        total + Math.min(advancePerGroup, seedIndexes.length),
      0,
    );
    const knockoutRounds = Math.log2(bracketSizeFor(qualifiers));
    const knockout = buildSingleElimination(qualifiers, thirdPlace).map(
      (plan) => ({
        ...plan,
        homeSeed: undefined,
        awaySeed: undefined,
        label:
          plan.phase === TournamentPhase.THIRD_PLACE
            ? plan.label
            : `Mata-mata · ${knockoutRoundLabel(plan.round, knockoutRounds)}`,
      }),
    );

    return [...groupPlans, ...knockout];
  }

  private assertStartable(
    format: TournamentFormat,
    teamCount: number,
    groupCount: number,
    advancePerGroup: number,
    legs: number,
    thirdPlace: boolean,
  ) {
    this.assertPlan(format, {
      teamCount,
      groupCount,
      advancePerGroup,
      legs,
      thirdPlace,
    });
  }

  /// Mesma checagem na criação, na edição e no início: a tela filtra as opções,
  /// mas a API é quem garante.
  private assertPlan(
    format: TournamentFormat,
    plan: {
      teamCount: number;
      groupCount: number;
      advancePerGroup: number;
      legs: number;
      thirdPlace: boolean;
    },
  ) {
    const issue = tournamentPlanIssue(format, plan);
    if (issue) throw new BadRequestException(issue);
  }

  private assertWindow(
    registrationEndsAt: Date | undefined,
    autoStartOnClose: boolean | undefined,
    startsAt?: Date,
  ) {
    if (registrationEndsAt && registrationEndsAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'O fim das inscrições precisa ser no futuro.',
      );
    }
    if (autoStartOnClose && !registrationEndsAt) {
      throw new BadRequestException(
        'Para começar sozinho, o campeonato precisa de uma data de fim das inscrições.',
      );
    }
    if (
      registrationEndsAt &&
      startsAt &&
      startsAt.getTime() <= registrationEndsAt.getTime()
    ) {
      throw new BadRequestException(
        'O início do campeonato precisa ser depois do fim das inscrições.',
      );
    }
  }

  private buildStandings(
    teams: Array<{
      id: string;
      name: string;
      tag: string | null;
      logoUrl: string | null;
      groupId: string | null;
      played: number;
      wins: number;
      draws: number;
      losses: number;
      scoreFor: number;
      scoreAgainst: number;
      points: number;
      eliminated: boolean;
    }>,
    groups: Array<{ id: string; name: string; order: number }>,
  ) {
    const rank = (rows: typeof teams) =>
      [...rows].sort(compareStandings).map((team, index) => ({
        position: index + 1,
        teamId: team.id,
        name: team.name,
        tag: team.tag,
        logoUrl: team.logoUrl,
        played: team.played,
        wins: team.wins,
        draws: team.draws,
        losses: team.losses,
        scoreFor: team.scoreFor,
        scoreAgainst: team.scoreAgainst,
        scoreDiff: team.scoreFor - team.scoreAgainst,
        points: team.points,
        eliminated: team.eliminated,
      }));

    if (groups.length === 0)
      return [{ groupId: null, groupName: 'Classificação', rows: rank(teams) }];

    return groups.map((group) => ({
      groupId: group.id,
      groupName: group.name,
      rows: rank(teams.filter((team) => team.groupId === group.id)),
    }));
  }

  private settingsFrom(dto: CreateTournamentDto | UpdateTournamentDto) {
    const { name, status, invitedUsernames, ...settings } =
      dto as UpdateTournamentDto;
    return Object.fromEntries(
      Object.entries(settings).filter(([, value]) => value !== undefined),
    );
  }

  private async requireTeam(tournamentId: string, teamId: string) {
    const team = await this.prisma.tournamentTeam.findFirst({
      where: { id: teamId, tournamentId },
    });
    if (!team)
      throw new NotFoundException('Time não encontrado neste campeonato.');
    return team;
  }

  private async uniqueSlug(name: string) {
    const base =
      name
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'campeonato';

    for (let attempt = 0; attempt < 50; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const taken = await this.prisma.tournament.findUnique({
        where: { slug },
      });
      if (!taken) return slug;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}

function planKey(plan: MatchPlan): string {
  return `${plan.phase}:${plan.round}:${plan.position}:${plan.leg}`;
}

function refKey(ref: {
  phase: TournamentPhase;
  round: number;
  position: number;
}): string {
  return `${ref.phase}:${ref.round}:${ref.position}:1`;
}
