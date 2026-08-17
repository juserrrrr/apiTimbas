import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogSource, DraftLeagueStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AttributeAiService } from './attribute-ai.service';
import { ATTRIBUTE_KEYS } from '../football/attributes';
import { parsePlayerLines, parseTeamLines } from './text-parser';
import {
  BulkTeamsDto,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly attributeAi: AttributeAiService,
  ) {}

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

  /// Leitura sem IA do texto colado, para o fluxo manual funcionar mesmo com a
  /// IA desligada. A IA fica como opção para texto bagunçado.
  parsePastedPlayers(text: string) {
    const players = parsePlayerLines(text);
    return { players: players.map((player) => ({ ...player, overall: player.overall ?? null })) };
  }

  parsePastedTeams(text: string) {
    return { teams: parseTeamLines(text) };
  }

  async createTeams(competitionId: string, teams: Array<{ name: string; shortName?: string | null }>) {
    await this.requireCompetition(competitionId);

    let created = 0;
    for (const team of teams) {
      const existing = await this.prisma.catalogTeam.findUnique({
        where: { competitionId_name: { competitionId, name: team.name } },
      });
      if (existing) continue;
      await this.prisma.catalogTeam.create({
        data: { competitionId, name: team.name, shortName: team.shortName ?? null, source: CatalogSource.MANUAL },
      });
      created++;
    }
    const total = await this.prisma.catalogTeam.count({ where: { competitionId } });
    return { created, total };
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

  /// Estima os atributos de quem ainda não tem, ou de todo o elenco quando o
  /// admin pede refazer. A escrita é jogador por jogador porque o modelo pode
  /// devolver a lista incompleta e o resto precisa ser salvo do mesmo jeito.
  async estimateTeamAttributes(teamId: string, onlyMissing: boolean) {
    const team = await this.requireTeam(teamId);
    const competition = await this.prisma.catalogCompetition.findUnique({
      where: { id: team.competitionId },
      select: { name: true },
    });

    const players = await this.prisma.catalogPlayer.findMany({
      where: {
        teamId,
        active: true,
        ...(onlyMissing ? { pace: null } : {}),
      },
      orderBy: { name: 'asc' },
    });
    if (players.length === 0) {
      throw new BadRequestException(
        onlyMissing ? 'Todos os jogadores deste time já têm atributos.' : 'Este time não tem jogadores ativos.',
      );
    }

    const estimation = await this.attributeAi.estimate(
      players.map((player) => ({
        name: player.name,
        position: player.position,
        realTeam: team.name,
        nationality: player.nationality,
        birthDate: player.birthDate,
        competition: competition?.name ?? null,
      })),
    );

    const byName = new Map(players.map((player) => [player.name, player]));
    const now = new Date();
    let updated = 0;

    for (const row of estimation.players) {
      const player = byName.get(row.name);
      if (!player) continue;
      await this.prisma.catalogPlayer.update({
        where: { id: player.id },
        data: {
          ...row.attributes,
          overall: row.overall,
          attributesModel: estimation.model,
          attributesNote: row.note || null,
          attributesAt: now,
        },
      });
      updated++;
    }

    return {
      updated,
      requested: players.length,
      model: estimation.model,
      missing: players.filter((player) => !estimation.players.some((row) => row.name === player.name)).length,
    };
  }

  async estimatePlayerAttributes(playerId: string) {
    const player = await this.prisma.catalogPlayer.findUnique({
      where: { id: playerId },
      include: { team: { include: { competition: { select: { name: true } } } } },
    });
    if (!player) throw new NotFoundException('Jogador não encontrado no catálogo.');

    const estimation = await this.attributeAi.estimate([
      {
        name: player.name,
        position: player.position,
        realTeam: player.team.name,
        nationality: player.nationality,
        birthDate: player.birthDate,
        competition: player.team.competition.name,
      },
    ]);

    const row = estimation.players[0];
    if (!row) throw new BadRequestException('A IA não conseguiu estimar este jogador. Tente de novo.');

    return this.prisma.catalogPlayer.update({
      where: { id: playerId },
      data: {
        ...row.attributes,
        overall: row.overall,
        attributesModel: estimation.model,
        attributesNote: row.note || null,
        attributesAt: new Date(),
      },
    });
  }

  async updatePlayer(playerId: string, dto: UpdatePlayerDto) {
    const player = await this.prisma.catalogPlayer.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Jogador não encontrado no catálogo.');

    // Atributo mexido na mão deixa de ser estimativa da IA, então a autoria sai.
    const manualAttributes = ATTRIBUTE_KEYS.some((key) => dto[key] !== undefined);
    return this.prisma.catalogPlayer.update({
      where: { id: playerId },
      data: {
        ...dto,
        ...(manualAttributes ? { attributesModel: null, attributesNote: null, attributesAt: new Date() } : {}),
      },
    });
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
        catalogPlayerId: player.id,
        name: player.name,
        position: player.position,
        overall: player.overall,
        realTeam: player.team.name,
        nationality: player.nationality,
        birthDate: player.birthDate,
        photoUrl: player.photoUrl,
        price: player.price,
        salary: Math.max(1, Math.round(player.price / 10)),
        pace: player.pace,
        shooting: player.shooting,
        passing: player.passing,
        dribbling: player.dribbling,
        defending: player.defending,
        physical: player.physical,
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
