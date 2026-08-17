import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { CatalogSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePosition } from './position.mapper';
import { parseSquadWikitext } from './wikipedia-squad.parser';

export interface SyncedPlayer {
  externalId: string | null;
  name: string;
  position: string;
  nationality: string | null;
  birthDate: Date | null;
}

export interface SyncedTeam {
  externalId: string | null;
  name: string;
  shortName: string | null;
  crestUrl: string | null;
  players: SyncedPlayer[];
}

const FOOTBALL_DATA_BASE = 'https://api.football-data.org/v4';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_CODE = 'WIKIPEDIA';
const WIKIPEDIA_HEADERS = {
  'User-Agent': 'Timbas/1.0 (https://github.com/juserrrrr/apiTimbas)',
  'Api-User-Agent': 'Timbas/1.0 (https://github.com/juserrrrr/apiTimbas)',
};

@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  hasFootballDataToken(): boolean {
    return Boolean(process.env.FOOTBALL_DATA_TOKEN?.trim());
  }

  async sync(competitionId: string) {
    const competition = await this.prisma.catalogCompetition.findUniqueOrThrow({
      where: { id: competitionId },
    });
    if (competition.source === CatalogSource.MANUAL) {
      throw new BadRequestException(
        'Esta competição é manual, não há fonte externa para sincronizar.',
      );
    }

    if (competition.source === CatalogSource.WIKIPEDIA) {
      throw new BadRequestException(
        'Envie a lista de times novamente para atualizar os elencos da Wikipedia.',
      );
    }

    try {
      const teams =
        competition.source === CatalogSource.FOOTBALL_DATA
          ? await this.fetchFromFootballData(competition.code)
          : await this.fetchFromGeneric(competition.sourcePath);

      const result = await this.persist(
        competitionId,
        teams,
        competition.source,
      );
      await this.prisma.catalogCompetition.update({
        where: { id: competitionId },
        data: {
          lastSyncAt: new Date(),
          lastSyncOk: true,
          lastSyncMessage: `${result.teams} times e ${result.players} jogadores atualizados.`,
        },
      });
      return result;
    } catch (error) {
      const message = describeSyncError(error);
      this.logger.warn(`Falha ao sincronizar ${competition.code}: ${message}`);
      await this.prisma.catalogCompetition.update({
        where: { id: competitionId },
        data: {
          lastSyncAt: new Date(),
          lastSyncOk: false,
          lastSyncMessage: message,
        },
      });
      throw new BadRequestException(message);
    }
  }

  async syncWikipedia(names: string[]) {
    const teams = [
      ...new Set(names.map((name) => name.trim()).filter(Boolean)),
    ];
    if (teams.length === 0)
      throw new BadRequestException(
        'Informe ao menos um time para buscar na Wikipedia.',
      );

    const competition = await this.prisma.catalogCompetition.upsert({
      where: { code: WIKIPEDIA_CODE },
      update: {
        name: 'Elencos da Wikipedia',
        source: CatalogSource.WIKIPEDIA,
        sourcePath: WIKIPEDIA_API,
      },
      create: {
        code: WIKIPEDIA_CODE,
        name: 'Elencos da Wikipedia',
        source: CatalogSource.WIKIPEDIA,
        sourcePath: WIKIPEDIA_API,
      },
    });

    const squads: SyncedTeam[] = [];
    const failures: string[] = [];
    for (const name of teams) {
      try {
        squads.push(await this.fetchWikipediaTeam(name));
      } catch (error) {
        failures.push(`${name}: ${describeWikipediaError(error)}`);
      }
    }
    if (squads.length === 0) {
      const message =
        failures.join(' | ') || 'Nenhum elenco foi encontrado na Wikipedia.';
      await this.prisma.catalogCompetition.update({
        where: { id: competition.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncOk: false,
          lastSyncMessage: message.slice(0, 240),
        },
      });
      throw new BadRequestException(message);
    }

    const result = await this.persist(
      competition.id,
      squads,
      CatalogSource.WIKIPEDIA,
    );
    const message = failures.length
      ? `${result.teams} times e ${result.players} jogadores atualizados. ${failures.length} time(s) não encontrado(s).`
      : `${result.teams} times e ${result.players} jogadores atualizados.`;
    await this.prisma.catalogCompetition.update({
      where: { id: competition.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncOk: failures.length === 0,
        lastSyncMessage: message,
      },
    });
    return { ...result, failures };
  }

  private async fetchFromFootballData(code: string): Promise<SyncedTeam[]> {
    const token = process.env.FOOTBALL_DATA_TOKEN?.trim();
    if (!token) {
      throw new BadRequestException(
        'FOOTBALL_DATA_TOKEN não está definida nesta instância da API.',
      );
    }

    const response = await axios.get(
      `${FOOTBALL_DATA_BASE}/competitions/${code}/teams`,
      {
        headers: { 'X-Auth-Token': token },
        timeout: 30000,
      },
    );

    const teams = response.data?.teams;
    if (!Array.isArray(teams))
      throw new BadRequestException(
        'A resposta da API não trouxe a lista de times.',
      );

    return teams.map((team: Record<string, any>) => ({
      externalId: team.id ? String(team.id) : null,
      name: String(team.name ?? '').trim(),
      shortName: team.tla ?? team.shortName ?? null,
      crestUrl: team.crest ?? null,
      players: Array.isArray(team.squad)
        ? team.squad
            .filter((player: Record<string, any>) => player?.name)
            .map((player: Record<string, any>) => ({
              externalId: player.id ? String(player.id) : null,
              name: String(player.name).trim(),
              position: normalizePosition(player.position),
              nationality: player.nationality ?? null,
              birthDate: player.dateOfBirth
                ? new Date(player.dateOfBirth)
                : null,
            }))
        : [],
    }));
  }

  private async fetchWikipediaTeam(name: string): Promise<SyncedTeam> {
    const direct = await this.wikipediaPage(name).catch(() => null);
    const titles = await this.wikipediaSearch(name);
    const candidates: Array<{ title: string; wikitext: string }> = direct
      ? [direct]
      : [];
    for (const title of titles) {
      const page = await this.wikipediaPage(title).catch(() => null);
      if (
        page &&
        !candidates.some((candidate) => candidate.title === page.title)
      )
        candidates.push(page);
    }

    for (const page of candidates) {
      const players = parseSquadWikitext(page.wikitext).map((player) => ({
        externalId: null,
        name: player.name,
        position: normalizePosition(player.position),
        nationality: player.nationality,
        birthDate: null,
      }));
      if (players.length > 0) {
        return {
          externalId: page.title,
          name,
          shortName: null,
          crestUrl: null,
          players,
        };
      }
    }
    throw new BadRequestException(
      'nenhuma página encontrada tem um elenco principal legível',
    );
  }

  private async wikipediaPage(
    name: string,
  ): Promise<{ title: string; wikitext: string }> {
    const response = await axios.get(WIKIPEDIA_API, {
      params: {
        action: 'query',
        format: 'json',
        formatversion: 2,
        redirects: 1,
        prop: 'revisions',
        rvprop: 'content',
        rvslots: 'main',
        titles: name,
      },
      headers: WIKIPEDIA_HEADERS,
      timeout: 30000,
    });
    const page = response.data?.query?.pages?.[0];
    const wikitext = page?.revisions?.[0]?.slots?.main?.content;
    if (!page || page.missing || typeof wikitext !== 'string') {
      throw new BadRequestException(
        'página não encontrada na Wikipedia em inglês',
      );
    }
    return { title: String(page.title), wikitext };
  }

  private async wikipediaSearch(name: string): Promise<string[]> {
    const response = await axios.get(WIKIPEDIA_API, {
      params: {
        action: 'query',
        format: 'json',
        list: 'search',
        srsearch: `${name} football club`,
        srlimit: 5,
      },
      headers: WIKIPEDIA_HEADERS,
      timeout: 30000,
    });
    const titles = response.data?.query?.search;
    return Array.isArray(titles)
      ? titles
          .map((entry: { title?: unknown }) => String(entry.title ?? ''))
          .filter(Boolean)
      : [];
  }

  private async fetchFromGeneric(url: string | null): Promise<SyncedTeam[]> {
    if (!url)
      throw new BadRequestException(
        'Nenhuma URL de origem configurada para esta competição.',
      );

    const response = await axios.get(url, { timeout: 30000 });
    const teams = response.data?.teams ?? response.data;
    if (!Array.isArray(teams)) {
      throw new BadRequestException(
        'A URL precisa devolver um array de times ou um objeto com a chave "teams".',
      );
    }

    return teams.map((team: Record<string, any>) => ({
      externalId: team.id ? String(team.id) : null,
      name: String(team.name ?? '').trim(),
      shortName: team.shortName ?? team.tla ?? null,
      crestUrl: team.crest ?? team.crestUrl ?? team.logo ?? null,
      players: Array.isArray(team.players ?? team.squad)
        ? (team.players ?? team.squad)
            .filter((player: Record<string, any>) => player?.name)
            .map((player: Record<string, any>) => ({
              externalId: player.id ? String(player.id) : null,
              name: String(player.name).trim(),
              position: normalizePosition(player.position),
              nationality: player.nationality ?? null,
              birthDate: player.dateOfBirth
                ? new Date(player.dateOfBirth)
                : null,
            }))
        : [],
    }));
  }

  /// Sincronizar nunca apaga: jogadores que sumiram da fonte só ficam inativos,
  /// para não derrubar elencos de ligas que já escolheram aquele jogador.
  private async persist(
    competitionId: string,
    teams: SyncedTeam[],
    source: CatalogSource,
  ) {
    const syncedAt = new Date();
    let teamCount = 0;
    let playerCount = 0;

    for (const team of teams) {
      if (!team.name) continue;

      const saved = await this.prisma.catalogTeam.upsert({
        where: { competitionId_name: { competitionId, name: team.name } },
        update: {
          externalId: team.externalId,
          shortName: team.shortName,
          crestUrl: team.crestUrl,
          source,
          syncedAt,
        },
        create: {
          competitionId,
          externalId: team.externalId,
          name: team.name,
          shortName: team.shortName,
          crestUrl: team.crestUrl,
          source,
          syncedAt,
        },
      });
      teamCount++;

      for (const player of team.players) {
        await this.prisma.catalogPlayer.upsert({
          where: { teamId_name: { teamId: saved.id, name: player.name } },
          update: {
            externalId: player.externalId,
            position: player.position,
            nationality: player.nationality,
            birthDate: player.birthDate,
            active: true,
            source,
            syncedAt,
          },
          create: {
            teamId: saved.id,
            externalId: player.externalId,
            name: player.name,
            position: player.position,
            nationality: player.nationality,
            birthDate: player.birthDate,
            source,
            syncedAt,
          },
        });
        playerCount++;
      }

      if (team.players.length > 0) {
        await this.prisma.catalogPlayer.updateMany({
          where: {
            teamId: saved.id,
            source: { not: CatalogSource.MANUAL },
            syncedAt: { lt: syncedAt },
          },
          data: { active: false },
        });
      }
    }

    return { teams: teamCount, players: playerCount };
  }
}

function describeSyncError(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  if (status === 403)
    return 'A API recusou o token (403). Confira o plano e a competição liberada.';
  if (status === 404)
    return 'Competição não encontrada na API (404). Confira o código.';
  if (status === 429)
    return 'Limite de requisições da API atingido (429). Tente de novo em alguns minutos.';
  const message = (error as { response?: { data?: { message?: string } } })
    ?.response?.data?.message;
  return String(
    message ?? (error as Error)?.message ?? 'Erro desconhecido',
  ).slice(0, 240);
}

function describeWikipediaError(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  if (status === 403)
    return 'a Wikipedia recusou a consulta (403). Tente novamente em alguns minutos.';
  if (status === 429)
    return 'a Wikipedia limitou as consultas (429). Tente novamente em alguns minutos.';
  return String((error as Error)?.message ?? 'Erro desconhecido').slice(0, 240);
}
