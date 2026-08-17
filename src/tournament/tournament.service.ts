import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CompetitionRole,
  Prisma,
  TournamentFormat,
  TournamentMatchStatus,
  TournamentPhase,
  TournamentStatus,
} from '@prisma/client';
import { Actor } from '../common/actor.service';
import { PrismaService } from '../prisma/prisma.service';
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
} from './bracket.builder';
import { resolveWalkovers } from './bracket-advance';
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

const MANAGED_STATUSES: TournamentStatus[] = [TournamentStatus.DRAFT, TournamentStatus.REGISTRATION];

// Espelham os defaults do schema, usados para validar o plano de grupos antes de
// o registro existir.
const DEFAULTS = { maxTeams: 8, groupCount: 2, advancePerGroup: 2 };

@Injectable()
export class TournamentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TournamentAccessService,
  ) {}

  async create(dto: CreateTournamentDto, actor: Actor) {
    this.assertGroupSettings(dto.format ?? TournamentFormat.SINGLE_ELIMINATION, {
      teamCount: dto.maxTeams ?? DEFAULTS.maxTeams,
      groupCount: dto.groupCount ?? DEFAULTS.groupCount,
      advancePerGroup: dto.advancePerGroup ?? DEFAULTS.advancePerGroup,
    });

    const slug = await this.uniqueSlug(dto.name);
    return this.prisma.tournament.create({
      data: {
        ...this.settingsFrom(dto),
        name: dto.name,
        slug,
        createdByDiscordId: actor.discordId,
        status: TournamentStatus.REGISTRATION,
        staff: { create: { userId: actor.id, role: CompetitionRole.OWNER } },
      },
      include: { staff: { include: { user: { select: { id: true, name: true, avatar: true } } } } },
    });
  }

  async list(query: ListTournamentsDto) {
    const where: Prisma.TournamentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.game ? { game: query.game } : {}),
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
            include: { user: { select: { id: true, name: true, avatar: true } } },
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
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        teams: {
          orderBy: [{ points: 'desc' }, { seed: 'asc' }, { name: 'asc' }],
          include: { members: { include: { user: { select: { id: true, name: true, avatar: true } } } } },
        },
        groups: { orderBy: { order: 'asc' } },
        staff: { include: { user: { select: { id: true, name: true, avatar: true } } } },
        matches: {
          orderBy: [{ phase: 'asc' }, { round: 'asc' }, { position: 'asc' }, { leg: 'asc' }],
          include: {
            homeTeam: { select: { id: true, name: true, tag: true, logoUrl: true, seed: true } },
            awayTeam: { select: { id: true, name: true, tag: true, logoUrl: true, seed: true } },
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

    const access = await this.access.of(id, actor);
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
    if (tournament.status === TournamentStatus.RUNNING || tournament.status === TournamentStatus.FINISHED) {
      for (const locked of ['format', 'maxTeams', 'groupCount', 'advancePerGroup', 'legs', 'thirdPlace'] as const) {
        delete settings[locked];
      }
    }

    // Só revalida quando a edição mexe no plano: durante as inscrições o total de
    // times ainda muda e nada mais precisa ficar preso a isso.
    const planKeys = ['format', 'maxTeams', 'groupCount', 'advancePerGroup'] as const;
    if (planKeys.some((key) => key in settings)) {
      this.assertGroupSettings((settings.format as TournamentFormat) ?? tournament.format, {
        teamCount: (settings.maxTeams as number) ?? tournament.maxTeams,
        groupCount: (settings.groupCount as number) ?? tournament.groupCount,
        advancePerGroup: (settings.advancePerGroup as number) ?? tournament.advancePerGroup,
      });
    }

    return this.prisma.tournament.update({
      where: { id },
      data: {
        ...settings,
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.status ? { status: dto.status } : {}),
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

    if (!access.canModerate) {
      if (tournament.status !== TournamentStatus.REGISTRATION) {
        throw new ForbiddenException('As inscrições deste campeonato estão fechadas.');
      }
      if (access.teamIds.length > 0) {
        throw new BadRequestException('Você já tem um time inscrito neste campeonato.');
      }
    }
    if (!MANAGED_STATUSES.includes(tournament.status)) {
      throw new BadRequestException('O campeonato já começou, não dá mais para inscrever times.');
    }

    const teamCount = await this.prisma.tournamentTeam.count({ where: { tournamentId: id } });
    if (teamCount >= tournament.maxTeams) {
      throw new BadRequestException(`O campeonato já atingiu o limite de ${tournament.maxTeams} times.`);
    }

    const memberIds = access.canModerate ? (dto.memberIds ?? []) : [actor.id];
    return this.prisma.tournamentTeam.create({
      data: {
        tournamentId: id,
        name: dto.name,
        tag: dto.tag,
        logoUrl: dto.logoUrl,
        eaClubId: dto.eaClubId,
        seed: teamCount + 1,
        ownerDiscordId: access.canModerate ? undefined : actor.discordId,
        members: {
          create: memberIds.map((userId, index) => ({ userId, captain: index === 0 })),
        },
      },
      include: { members: { include: { user: { select: { id: true, name: true, avatar: true } } } } },
    });
  }

  async updateTeam(id: string, teamId: string, dto: UpdateTeamDto, actor: Actor) {
    const team = await this.requireTeam(id, teamId);
    const access = await this.access.of(id, actor);
    const isTeamOwner = access.teamIds.includes(team.id);
    if (!access.canModerate && !isTeamOwner) {
      throw new ForbiddenException('Você não pode editar este time.');
    }

    return this.prisma.tournamentTeam.update({
      where: { id: teamId },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.tag !== undefined ? { tag: dto.tag } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
        ...(dto.eaClubId !== undefined ? { eaClubId: dto.eaClubId } : {}),
        ...(dto.seed !== undefined && access.canModerate ? { seed: dto.seed } : {}),
      },
    });
  }

  async removeTeam(id: string, teamId: string, actor: Actor) {
    const tournament = await this.access.requireExists(id);
    const team = await this.requireTeam(id, teamId);
    const access = await this.access.of(id, actor);

    if (!access.canModerate && !access.teamIds.includes(team.id)) {
      throw new ForbiddenException('Você não pode remover este time.');
    }
    if (!MANAGED_STATUSES.includes(tournament.status)) {
      throw new BadRequestException('O campeonato já começou. Use W.O. em vez de remover o time.');
    }

    await this.prisma.tournamentTeam.delete({ where: { id: teamId } });
    return { deleted: true };
  }

  async setSeeds(id: string, dto: SetSeedsDto, actor: Actor) {
    await this.access.requireModerate(id, actor);
    const tournament = await this.access.requireExists(id);
    if (!MANAGED_STATUSES.includes(tournament.status)) {
      throw new BadRequestException('Não dá para mudar o chaveamento com o campeonato em andamento.');
    }

    await this.prisma.$transaction(
      dto.seeds.map((entry) =>
        this.prisma.tournamentTeam.update({
          where: { id: entry.teamId },
          data: { seed: entry.seed },
        }),
      ),
    );
    return this.prisma.tournamentTeam.findMany({ where: { tournamentId: id }, orderBy: { seed: 'asc' } });
  }

  async setStaff(id: string, dto: StaffDto, actor: Actor) {
    await this.access.requireManage(id, actor);
    if (dto.role === CompetitionRole.OWNER) {
      throw new BadRequestException('Use a transferência de propriedade para trocar o dono.');
    }
    return this.prisma.tournamentStaff.upsert({
      where: { tournamentId_userId: { tournamentId: id, userId: dto.userId } },
      update: { role: dto.role, addedByUserId: actor.id },
      create: { tournamentId: id, userId: dto.userId, role: dto.role, addedByUserId: actor.id },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
  }

  async removeStaff(id: string, userId: number, actor: Actor) {
    await this.access.requireManage(id, actor);
    const staff = await this.prisma.tournamentStaff.findUnique({
      where: { tournamentId_userId: { tournamentId: id, userId } },
    });
    if (!staff) throw new NotFoundException('Esse usuário não faz parte da organização.');
    if (staff.role === CompetitionRole.OWNER) {
      throw new BadRequestException('O dono do campeonato não pode ser removido.');
    }
    await this.prisma.tournamentStaff.delete({ where: { id: staff.id } });
    return { removed: true };
  }

  async transferOwnership(id: string, userId: number, actor: Actor) {
    await this.access.requireManage(id, actor);
    if (userId === actor.id) throw new BadRequestException('Você já é o dono deste campeonato.');

    return this.prisma.$transaction(async (tx) => {
      await tx.tournamentStaff.updateMany({
        where: { tournamentId: id, role: CompetitionRole.OWNER },
        data: { role: CompetitionRole.MODERATOR },
      });
      return tx.tournamentStaff.upsert({
        where: { tournamentId_userId: { tournamentId: id, userId } },
        update: { role: CompetitionRole.OWNER },
        create: { tournamentId: id, userId, role: CompetitionRole.OWNER, addedByUserId: actor.id },
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
    this.assertStartable(tournament.format, teams.length, tournament.groupCount, tournament.advancePerGroup);

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
            : this.planFor(tournament.format, teams.length, tournament.legs, tournament.thirdPlace);

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
          groupTeams.set(group.order, members.map((member) => member.id));
        }

        const created = new Map<string, string>();
        for (const plan of plans) {
          const pool = plan.groupOrder !== undefined ? (groupTeams.get(plan.groupOrder) ?? []) : teamIdsBySeed;
          const homeTeamId = this.resolveTeam(plan.homeSeed, plan.homeIndex, pool, teamIdsBySeed);
          const awayTeamId = this.resolveTeam(plan.awaySeed, plan.awayIndex, pool, teamIdsBySeed);

          const match = await tx.tournamentMatch.create({
            data: {
              tournamentId: id,
              groupId: plan.groupOrder !== undefined ? groups[plan.groupOrder]?.id : null,
              phase: plan.phase,
              round: plan.round,
              position: plan.position,
              leg: plan.leg,
              label: plan.label,
              homeTeamId,
              awayTeamId,
              status:
                homeTeamId && awayTeamId ? TournamentMatchStatus.READY : TournamentMatchStatus.PENDING,
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
            await tx.tournamentMatch.update({ where: { id: created.get(planKey(plan))! }, data });
          }
        }

        await resolveWalkovers(tx, id);

        return tx.tournament.update({
          where: { id },
          data: { status: TournamentStatus.RUNNING, startsAt: tournament.startsAt ?? new Date() },
        });
      },
      { timeout: 30000 },
    );
  }

  async scheduleMatch(tournamentId: string, matchId: string, scheduledAt: Date) {
    const match = await this.prisma.tournamentMatch.findFirst({ where: { id: matchId, tournamentId } });
    if (!match) throw new NotFoundException('Partida não encontrada neste campeonato.');
    return this.prisma.tournamentMatch.update({ where: { id: matchId }, data: { scheduledAt } });
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

  private planFor(format: TournamentFormat, teamCount: number, legs: number, thirdPlace: boolean): MatchPlan[] {
    if (format === TournamentFormat.SINGLE_ELIMINATION) return buildSingleElimination(teamCount, thirdPlace);
    if (format === TournamentFormat.DOUBLE_ELIMINATION) return buildDoubleElimination(teamCount);
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
        where: { id: { in: seedIndexes.map((seedIndex) => teamIdsBySeed[seedIndex]) } },
        data: { groupId: group.id },
      });
    }

    const groupPlans = buildGroupStage(
      distribution.map((seedIndexes) => seedIndexes.length),
      legs,
    );

    const qualifiers = distribution.reduce(
      (total, seedIndexes) => total + Math.min(advancePerGroup, seedIndexes.length),
      0,
    );
    const knockoutRounds = Math.log2(bracketSizeFor(qualifiers));
    const knockout = buildSingleElimination(qualifiers, thirdPlace).map((plan) => ({
      ...plan,
      homeSeed: undefined,
      awaySeed: undefined,
      label:
        plan.phase === TournamentPhase.THIRD_PLACE
          ? plan.label
          : `Mata-mata · ${knockoutRoundLabel(plan.round, knockoutRounds)}`,
    }));

    return [...groupPlans, ...knockout];
  }

  private assertStartable(
    format: TournamentFormat,
    teamCount: number,
    groupCount: number,
    advancePerGroup: number,
  ) {
    if (teamCount < 2) throw new BadRequestException('É preciso ao menos 2 times inscritos para começar.');
    if (format === TournamentFormat.DOUBLE_ELIMINATION && teamCount < 4) {
      throw new BadRequestException('Eliminação dupla precisa de ao menos 4 times.');
    }
    this.assertGroupSettings(format, { teamCount, groupCount, advancePerGroup });
  }

  private assertGroupSettings(
    format: TournamentFormat,
    plan: { teamCount: number; groupCount: number; advancePerGroup: number },
  ) {
    if (format !== TournamentFormat.GROUPS_KNOCKOUT) return;
    const issue = groupPlanIssue(plan.teamCount, plan.groupCount, plan.advancePerGroup);
    if (issue) throw new BadRequestException(issue);
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
      [...rows]
        .sort(compareStandings)
        .map((team, index) => ({
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

    if (groups.length === 0) return [{ groupId: null, groupName: 'Classificação', rows: rank(teams) }];

    return groups.map((group) => ({
      groupId: group.id,
      groupName: group.name,
      rows: rank(teams.filter((team) => team.groupId === group.id)),
    }));
  }

  private settingsFrom(dto: CreateTournamentDto | UpdateTournamentDto) {
    const { name, status, ...settings } = dto as UpdateTournamentDto;
    return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
  }

  private async requireTeam(tournamentId: string, teamId: string) {
    const team = await this.prisma.tournamentTeam.findFirst({ where: { id: teamId, tournamentId } });
    if (!team) throw new NotFoundException('Time não encontrado neste campeonato.');
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
      const taken = await this.prisma.tournament.findUnique({ where: { slug } });
      if (!taken) return slug;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}

function planKey(plan: MatchPlan): string {
  return `${plan.phase}:${plan.round}:${plan.position}:${plan.leg}`;
}

function refKey(ref: { phase: TournamentPhase; round: number; position: number }): string {
  return `${ref.phase}:${ref.round}:${ref.position}:1`;
}
