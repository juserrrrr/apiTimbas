import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogSource, DraftLeagueStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BulkPlayersDto,
  CreateCompetitionDto,
  CreateTeamDto,
  ImportToLeagueDto,
  UpdateCompetitionDto,
  UpdatePlayerDto,
  UpdateTeamDto,
} from './dto/player-catalog.dto';

@Injectable()
export class PlayerCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listCompetitions() {
    const competitions = await this.prisma.catalogCompetition.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { teams: true } } },
    });

    return Promise.all(
      competitions.map(async (competition) => ({
        ...competition,
        teamCount: competition._count.teams,
        playerCount: await this.prisma.catalogPlayer.count({
          where: { team: { competitionId: competition.id }, active: true },
        }),
        _count: undefined,
      })),
    );
  }

  createCompetition(dto: CreateCompetitionDto) {
    return this.prisma.catalogCompetition.create({ data: dto });
  }

  async updateCompetition(id: string, dto: UpdateCompetitionDto) {
    await this.requireCompetition(id);
    return this.prisma.catalogCompetition.update({ where: { id }, data: dto });
  }

  async removeCompetition(id: string) {
    await this.requireCompetition(id);
    await this.prisma.catalogCompetition.delete({ where: { id } });
    return { deleted: true };
  }

  async listTeams(competitionId: string) {
    await this.requireCompetition(competitionId);
    return this.prisma.catalogTeam.findMany({
      where: { competitionId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { players: true } } },
    });
  }

  async createTeam(competitionId: string, dto: CreateTeamDto) {
    await this.requireCompetition(competitionId);
    return this.prisma.catalogTeam.create({
      data: { ...dto, competitionId, source: CatalogSource.MANUAL },
    });
  }

  async updateTeam(teamId: string, dto: UpdateTeamDto) {
    await this.requireTeam(teamId);
    return this.prisma.catalogTeam.update({ where: { id: teamId }, data: dto });
  }

  async removeTeam(teamId: string) {
    await this.requireTeam(teamId);
    await this.prisma.catalogTeam.delete({ where: { id: teamId } });
    return { deleted: true };
  }

  async listPlayers(teamId: string) {
    await this.requireTeam(teamId);
    return this.prisma.catalogPlayer.findMany({
      where: { teamId },
      orderBy: [{ active: 'desc' }, { overall: 'desc' }, { name: 'asc' }],
    });
  }

  async savePlayers(teamId: string, dto: BulkPlayersDto) {
    await this.requireTeam(teamId);

    let created = 0;
    let updated = 0;
    for (const player of dto.players) {
      const existing = await this.prisma.catalogPlayer.findUnique({
        where: { teamId_name: { teamId, name: player.name } },
      });
      if (existing) {
        await this.prisma.catalogPlayer.update({
          where: { id: existing.id },
          data: { ...player, active: true },
        });
        updated++;
      } else {
        await this.prisma.catalogPlayer.create({
          data: { ...player, teamId, source: CatalogSource.MANUAL },
        });
        created++;
      }
    }
    return { created, updated };
  }

  async updatePlayer(playerId: string, dto: UpdatePlayerDto) {
    const player = await this.prisma.catalogPlayer.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Jogador não encontrado no catálogo.');
    return this.prisma.catalogPlayer.update({ where: { id: playerId }, data: dto });
  }

  async removePlayer(playerId: string) {
    const player = await this.prisma.catalogPlayer.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Jogador não encontrado no catálogo.');
    await this.prisma.catalogPlayer.delete({ where: { id: playerId } });
    return { deleted: true };
  }

  async importToLeague(dto: ImportToLeagueDto) {
    const league = await this.prisma.draftLeague.findUnique({ where: { id: dto.leagueId } });
    if (!league) throw new NotFoundException('Liga não encontrada.');
    if (league.status !== DraftLeagueStatus.SETUP) {
      throw new BadRequestException('O pool só pode ser carregado antes do draft começar.');
    }

    const players = await this.prisma.catalogPlayer.findMany({
      where: {
        active: true,
        team: {
          competitionId: dto.competitionId,
          ...(dto.teamIds?.length ? { id: { in: dto.teamIds } } : {}),
        },
        ...(dto.minOverall ? { overall: { gte: dto.minOverall } } : {}),
      },
      include: { team: { select: { name: true } } },
      orderBy: [{ overall: 'desc' }, { name: 'asc' }],
    });

    if (players.length === 0) {
      throw new BadRequestException('Nenhum jogador ativo encontrado com esse filtro.');
    }

    if (dto.replace) {
      await this.prisma.draftPlayer.deleteMany({ where: { leagueId: dto.leagueId } });
    }

    const seen = new Set<string>();
    const rows = players
      .filter((player) => {
        const key = player.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((player) => ({
        leagueId: dto.leagueId,
        name: player.name,
        position: player.position,
        overall: player.overall,
        realTeam: player.team.name,
        nationality: player.nationality,
        photoUrl: player.photoUrl,
        price: player.price,
      }));

    const result = await this.prisma.draftPlayer.createMany({ data: rows, skipDuplicates: true });
    const total = await this.prisma.draftPlayer.count({ where: { leagueId: dto.leagueId } });
    return { imported: result.count, total };
  }

  private async requireCompetition(id: string) {
    const competition = await this.prisma.catalogCompetition.findUnique({ where: { id } });
    if (!competition) throw new NotFoundException('Competição não encontrada no catálogo.');
    return competition;
  }

  private async requireTeam(id: string) {
    const team = await this.prisma.catalogTeam.findUnique({ where: { id } });
    if (!team) throw new NotFoundException('Time não encontrado no catálogo.');
    return team;
  }
}
