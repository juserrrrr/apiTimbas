import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CompetitionRole, DraftLeagueStatus, Prisma } from '@prisma/client';
import { Actor } from '../common/actor.service';
import { PrismaService } from '../prisma/prisma.service';
import { DraftAccessService } from './draft-access.service';
import { pickCoordinate, upcomingPicks } from './draft-order';
import {
  CreateDraftLeagueDto,
  DraftStaffDto,
  ImportPlayersDto,
  JoinDraftDto,
  ListDraftLeaguesDto,
  SetLineupDto,
  SetTacticsDto,
  UpdateDraftLeagueDto,
} from './dto/draft.dto';

@Injectable()
export class DraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DraftAccessService,
  ) {}

  async create(dto: CreateDraftLeagueDto, actor: Actor) {
    const { name, sourceCompetitionIds, ...settings } = dto;
    return this.prisma.draftLeague.create({
      data: {
        ...Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)),
        name,
        createdByDiscordId: actor.discordId,
        staff: { create: { userId: actor.id, role: CompetitionRole.OWNER } },
        ...(sourceCompetitionIds?.length
          ? { sources: { create: sourceCompetitionIds.map((competitionId) => ({ competitionId })) } }
          : {}),
      },
      include: { sources: true },
    });
  }

  async list(query: ListDraftLeaguesDto) {
    return this.prisma.draftLeague.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { rosters: true, players: true } },
        staff: {
          where: { role: CompetitionRole.OWNER },
          include: { user: { select: { id: true, name: true, avatar: true } } },
        },
      },
    });
  }

  async detail(leagueId: string, actor: Actor) {
    const league = await this.prisma.draftLeague.findUnique({
      where: { id: leagueId },
      include: {
        staff: { include: { user: { select: { id: true, name: true, avatar: true } } } },
        sources: { include: { competition: { select: { id: true, name: true, country: true } } } },
        rosters: {
          orderBy: [{ points: 'desc' }, { draftOrder: 'asc' }],
          include: {
            user: { select: { id: true, name: true, avatar: true } },
            players: { orderBy: [{ starter: 'desc' }, { overall: 'desc' }] },
          },
        },
      },
    });
    if (!league) throw new NotFoundException('Liga não encontrada.');

    const access = await this.access.of(leagueId, actor);
    return {
      ...league,
      access,
      standings: this.buildStandings(league.rosters),
      board: this.buildBoard(league),
    };
  }

  async update(leagueId: string, dto: UpdateDraftLeagueDto, actor: Actor) {
    await this.access.requireManage(leagueId, actor);
    const league = await this.access.requireLeague(leagueId);
    const { name, status, sourceCompetitionIds, ...settings } = dto;

    const locked = league.status !== DraftLeagueStatus.SETUP;
    const editable = Object.fromEntries(
      Object.entries(settings).filter(
        ([key, value]) => value !== undefined && !(locked && ['rosterSize', 'orderType'].includes(key)),
      ),
    );

    if (sourceCompetitionIds) {
      await this.prisma.$transaction([
        this.prisma.draftLeagueSource.deleteMany({
          where: { leagueId, competitionId: { notIn: sourceCompetitionIds } },
        }),
        ...sourceCompetitionIds.map((competitionId) =>
          this.prisma.draftLeagueSource.upsert({
            where: { leagueId_competitionId: { leagueId, competitionId } },
            update: {},
            create: { leagueId, competitionId },
          }),
        ),
      ]);
    }

    return this.prisma.draftLeague.update({
      where: { id: leagueId },
      data: { ...editable, ...(name ? { name } : {}), ...(status ? { status } : {}) },
      include: { sources: true },
    });
  }

  /// Tática é do treinador do elenco, e o moderador pode ajustar pelo elenco de
  /// alguém que não apareceu.
  async setTactics(leagueId: string, dto: SetTacticsDto, actor: Actor) {
    const access = await this.access.of(leagueId, actor);
    const rosterId = dto.rosterId && access.canModerate ? dto.rosterId : access.rosterId;
    if (!rosterId) throw new ForbiddenException('Você não tem elenco nesta liga.');

    const roster = await this.prisma.draftRoster.findFirst({ where: { id: rosterId, leagueId } });
    if (!roster) throw new NotFoundException('Elenco não encontrado nesta liga.');

    return this.prisma.draftRoster.update({
      where: { id: roster.id },
      data: {
        ...(dto.formation ? { formation: dto.formation } : {}),
        ...(dto.mentality ? { mentality: dto.mentality } : {}),
        ...(dto.pressing ? { pressing: dto.pressing } : {}),
        ...(dto.tempo ? { tempo: dto.tempo } : {}),
        tacticsAt: new Date(),
      },
    });
  }

  async remove(leagueId: string, actor: Actor) {
    await this.access.requireManage(leagueId, actor);
    await this.prisma.draftLeague.delete({ where: { id: leagueId } });
    return { deleted: true };
  }

  async join(leagueId: string, dto: JoinDraftDto, actor: Actor) {
    const league = await this.access.requireLeague(leagueId);
    if (league.status !== DraftLeagueStatus.SETUP) {
      throw new BadRequestException('Esta liga já saiu da fase de inscrições.');
    }

    const existing = await this.prisma.draftRoster.findUnique({
      where: { leagueId_userId: { leagueId, userId: actor.id } },
    });
    if (existing) throw new BadRequestException('Você já tem um elenco nesta liga.');

    const count = await this.prisma.draftRoster.count({ where: { leagueId } });
    return this.prisma.draftRoster.create({
      data: {
        leagueId,
        userId: actor.id,
        name: dto.name,
        tag: dto.tag,
        logoUrl: dto.logoUrl,
        formation: league.formation,
        draftOrder: count + 1,
      },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
  }

  async leave(leagueId: string, actor: Actor) {
    const league = await this.access.requireLeague(leagueId);
    if (league.status !== DraftLeagueStatus.SETUP) {
      throw new BadRequestException('Não dá para sair depois que o draft começou.');
    }
    const roster = await this.access.requireRoster(leagueId, actor);
    await this.prisma.draftRoster.delete({ where: { id: roster.id } });
    return { left: true };
  }

  async importPlayers(leagueId: string, dto: ImportPlayersDto, actor: Actor) {
    await this.access.requireModerate(leagueId, actor);
    const league = await this.access.requireLeague(leagueId);
    if (league.status !== DraftLeagueStatus.SETUP) {
      throw new BadRequestException('O elenco de jogadores só pode ser alterado antes do draft.');
    }

    const seen = new Set<string>();
    const players = dto.players.filter((player) => {
      const key = player.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return this.prisma.$transaction(async (tx) => {
      if (dto.replace) await tx.draftPlayer.deleteMany({ where: { leagueId } });
      const created = await tx.draftPlayer.createMany({
        data: players.map((player) => ({ ...player, leagueId })),
        skipDuplicates: true,
      });
      const total = await tx.draftPlayer.count({ where: { leagueId } });
      return { imported: created.count, total };
    });
  }

  async listPlayers(leagueId: string, onlyFree: boolean, search?: string, position?: string) {
    return this.prisma.draftPlayer.findMany({
      where: {
        leagueId,
        ...(onlyFree ? { rosterId: null } : {}),
        ...(position ? { position: { equals: position, mode: 'insensitive' } } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ overall: 'desc' }, { name: 'asc' }],
      take: 400,
      include: { roster: { select: { id: true, name: true, tag: true } } },
    });
  }

  async removePlayer(leagueId: string, playerId: string, actor: Actor) {
    await this.access.requireModerate(leagueId, actor);
    const player = await this.prisma.draftPlayer.findFirst({ where: { id: playerId, leagueId } });
    if (!player) throw new NotFoundException('Jogador não encontrado nesta liga.');
    if (player.rosterId) throw new BadRequestException('Esse jogador já pertence a um elenco.');
    await this.prisma.draftPlayer.delete({ where: { id: playerId } });
    return { deleted: true };
  }

  async setStaff(leagueId: string, dto: DraftStaffDto, actor: Actor) {
    await this.access.requireManage(leagueId, actor);
    if (dto.role === CompetitionRole.OWNER) {
      throw new BadRequestException('Use a transferência de propriedade para trocar o dono.');
    }
    return this.prisma.draftStaff.upsert({
      where: { leagueId_userId: { leagueId, userId: dto.userId } },
      update: { role: dto.role, addedByUserId: actor.id },
      create: { leagueId, userId: dto.userId, role: dto.role, addedByUserId: actor.id },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
  }

  async removeStaff(leagueId: string, userId: number, actor: Actor) {
    await this.access.requireManage(leagueId, actor);
    const staff = await this.prisma.draftStaff.findUnique({
      where: { leagueId_userId: { leagueId, userId } },
    });
    if (!staff) throw new NotFoundException('Esse usuário não faz parte da organização.');
    if (staff.role === CompetitionRole.OWNER) {
      throw new BadRequestException('O dono da liga não pode ser removido.');
    }
    await this.prisma.draftStaff.delete({ where: { id: staff.id } });
    return { removed: true };
  }

  async transferOwnership(leagueId: string, userId: number, actor: Actor) {
    await this.access.requireManage(leagueId, actor);
    if (userId === actor.id) throw new BadRequestException('Você já é o dono desta liga.');

    return this.prisma.$transaction(async (tx) => {
      await tx.draftStaff.updateMany({
        where: { leagueId, role: CompetitionRole.OWNER },
        data: { role: CompetitionRole.MODERATOR },
      });
      return tx.draftStaff.upsert({
        where: { leagueId_userId: { leagueId, userId } },
        update: { role: CompetitionRole.OWNER },
        create: { leagueId, userId, role: CompetitionRole.OWNER, addedByUserId: actor.id },
        include: { user: { select: { id: true, name: true, avatar: true } } },
      });
    });
  }

  async setLineup(leagueId: string, dto: SetLineupDto, actor: Actor) {
    const roster = await this.access.requireRoster(leagueId, actor);
    const owned = await this.prisma.draftPlayer.findMany({
      where: { rosterId: roster.id },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((player) => player.id));

    for (const starter of dto.starters) {
      if (!ownedIds.has(starter.playerId)) {
        throw new BadRequestException('Só dá para escalar jogadores do seu próprio elenco.');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.draftPlayer.updateMany({
        where: { rosterId: roster.id },
        data: { starter: false, slot: null },
      });
      for (const starter of dto.starters) {
        await tx.draftPlayer.update({
          where: { id: starter.playerId },
          data: { starter: true, slot: starter.slot },
        });
      }
      if (dto.formation) {
        await tx.draftRoster.update({ where: { id: roster.id }, data: { formation: dto.formation } });
      }
    });

    return this.prisma.draftRoster.findUnique({
      where: { id: roster.id },
      include: { players: { orderBy: [{ starter: 'desc' }, { overall: 'desc' }] } },
    });
  }

  private buildStandings(
    rosters: Array<{
      id: string;
      name: string;
      tag: string | null;
      logoUrl: string | null;
      played: number;
      wins: number;
      draws: number;
      losses: number;
      goalsFor: number;
      goalsAgainst: number;
      points: number;
      user: { id: number; name: string; avatar: string | null };
    }>,
  ) {
    return [...rosters]
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
          b.goalsFor - a.goalsFor ||
          a.name.localeCompare(b.name),
      )
      .map((roster, index) => ({
        position: index + 1,
        rosterId: roster.id,
        name: roster.name,
        tag: roster.tag,
        logoUrl: roster.logoUrl,
        manager: roster.user,
        played: roster.played,
        wins: roster.wins,
        draws: roster.draws,
        losses: roster.losses,
        goalsFor: roster.goalsFor,
        goalsAgainst: roster.goalsAgainst,
        goalDiff: roster.goalsFor - roster.goalsAgainst,
        points: roster.points,
      }));
  }

  private buildBoard(league: {
    status: DraftLeagueStatus;
    orderType: Prisma.DraftLeagueGetPayload<object>['orderType'];
    rosterSize: number;
    currentPickNumber: number;
    pickDeadline: Date | null;
    rosters: Array<{ id: string; name: string; draftOrder: number }>;
  }) {
    const order = [...league.rosters].sort((a, b) => a.draftOrder - b.draftOrder);
    const totalPicks = order.length * league.rosterSize;
    if (league.status !== DraftLeagueStatus.DRAFTING || order.length === 0) {
      return { active: false, totalPicks, currentPickNumber: league.currentPickNumber, onTheClock: null, queue: [] };
    }

    const current = pickCoordinate(league.currentPickNumber, order.length, league.orderType);
    const queue = upcomingPicks(league.currentPickNumber, totalPicks, order.length, league.orderType, 6).map(
      (pick) => ({ round: pick.round, roster: order[pick.rosterIndex] }),
    );

    return {
      active: true,
      totalPicks,
      currentPickNumber: league.currentPickNumber,
      currentRound: current.round,
      pickDeadline: league.pickDeadline,
      onTheClock: order[current.rosterIndex] ?? null,
      queue,
    };
  }
}
