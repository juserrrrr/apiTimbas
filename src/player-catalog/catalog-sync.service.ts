import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { CatalogSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlayerAttributes } from '../football/attributes';
import { marketValueFor } from '../football/market-value';
import { AiSquadService } from './ai-squad.service';
import { SofifaService, SofifaPlayer } from './sofifa.service';
import { normalizePosition, normalizeShirtNumber } from './position.mapper';
import { parseSquadWikitext } from './wikipedia-squad.parser';

export interface SyncedPlayer {
  externalId: string | null;
  name: string;
  position: string;
  shirtNumber: number | null;
  nationality: string | null;
  birthDate: Date | null;
  /// Só a IA traz o card pronto. As outras fontes deixam para a estimativa.
  card: SyncedCard | null;
}

export interface SyncedCard {
  attributes: PlayerAttributes;
  overall: number;
  model: string;
  note: string | null;
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
const AI_CODE = 'AI_SQUADS';
/// Abaixo disso o modelo já avisou que não tem certeza de que o jogador estava
/// no elenco. Entra na base só quem ele reconhece de verdade.
const MIN_AI_CONFIDENCE = 40;
/// Cada clube é uma chamada de modelo, e um elenco demora. Vinte clubes numa
/// requisição só passam de dez minutos e o navegador corta no meio, então todo
/// caminho que busca elenco vai em lote curto e a tela repete até acabar.
const DEFAULT_AI_FILL_BATCH = 3;
/// O SoFIFA responde em menos de um segundo por clube, então cabe uma liga
/// inteira na mesma requisição. O teto existe só para não varrer sem limite.
const MAX_SOFIFA_TEAMS = 25;
const MAX_AI_FILL_BATCH = 6;
const WIKIPEDIA_HEADERS = {
  'User-Agent': 'Timbas/1.0 (https://github.com/juserrrrr/apiTimbas)',
  'Api-User-Agent': 'Timbas/1.0 (https://github.com/juserrrrr/apiTimbas)',
};

@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiSquad: AiSquadService,
    private readonly sofifa: SofifaService,
  ) {}

  /// A liga inteira do FC 26: o SoFIFA diz quais clubes a disputam e todos
  /// entram como pastas. Os elencos ficam para `fillCompetitionFromSofifa`, que
  /// é rápido mas são vinte páginas.
  async createSofifaCompetition(input: { name: string; code?: string }) {
    const league = await this.sofifa.findLeague(input.name);
    const teams = await this.sofifa.fetchLeagueTeams(league.id);
    if (teams.length === 0) {
      throw new BadRequestException(`O SoFIFA não listou clubes para ${league.name}.`);
    }

    const code = (input.code?.trim() || slugCode(`${league.name} ${league.country ?? ''}`)).toUpperCase();
    const competition = await this.prisma.catalogCompetition.upsert({
      where: { code },
      update: { name: league.name, country: league.country, source: CatalogSource.SOFIFA },
      create: {
        code,
        name: league.name,
        country: league.country,
        source: CatalogSource.SOFIFA,
      },
    });

    const syncedAt = new Date();
    let created = 0;
    for (const team of teams) {
      const existing = await this.prisma.catalogTeam.findUnique({
        where: { competitionId_name: { competitionId: competition.id, name: team.name } },
      });
      if (existing) continue;
      await this.prisma.catalogTeam.create({
        data: {
          competitionId: competition.id,
          externalId: String(team.id),
          name: team.name,
          source: CatalogSource.SOFIFA,
          syncedAt,
        },
      });
      created++;
    }

    return { competition, league, teams, created };
  }

  /// Elenco do FC 26, tirado do SoFIFA. É a fonte a se preferir quando o clube
  /// está no jogo: vem o elenco inteiro, com os seis atributos do card medidos,
  /// em vez do que o modelo lembra.
  async fillTeamFromSofifa(teamId: string) {
    const team = await this.prisma.catalogTeam.findUniqueOrThrow({
      where: { id: teamId },
      include: { competition: { select: { id: true } } },
    });

    const squad = await this.sofifaSquad(team);
    const result = await this.persist(
      team.competition.id,
      [
        {
          externalId: String(squad.teamId),
          name: team.name,
          shortName: null,
          crestUrl: null,
          players: squad.players.map(toSyncedPlayer),
        },
      ],
      CatalogSource.SOFIFA,
    );

    return { ...result, team: team.name, matched: squad.teamName };
  }

  /// Os clubes vazios da competição, de uma vez: aqui cada time é uma página
  /// HTML, não uma chamada de modelo, então cabe tudo numa requisição só.
  async fillCompetitionFromSofifa(competitionId: string, limit?: number) {
    await this.prisma.catalogCompetition.findUniqueOrThrow({ where: { id: competitionId } });
    const teams = await this.prisma.catalogTeam.findMany({
      where: { competitionId, players: { none: { active: true } } },
      orderBy: { name: 'asc' },
      take: Math.min(Math.max(limit ?? MAX_SOFIFA_TEAMS, 1), MAX_SOFIFA_TEAMS),
    });

    const squads: SyncedTeam[] = [];
    const failures: string[] = [];
    for (const team of teams) {
      try {
        const squad = await this.sofifaSquad(team);
        squads.push({
          externalId: String(squad.teamId),
          name: team.name,
          shortName: null,
          crestUrl: null,
          players: squad.players.map(toSyncedPlayer),
        });
      } catch (error) {
        failures.push(`${team.name}: ${(error as Error)?.message ?? 'erro desconhecido'}`);
      }
    }

    if (squads.length === 0) {
      throw new BadRequestException(
        failures.join(' | ') || 'Nenhum clube vazio para preencher nesta competição.',
      );
    }

    const result = await this.persist(competitionId, squads, CatalogSource.SOFIFA);
    const remaining = await this.prisma.catalogTeam.count({
      where: { competitionId, players: { none: { active: true } } },
    });

    await this.prisma.catalogCompetition.update({
      where: { id: competitionId },
      data: {
        lastSyncAt: new Date(),
        lastSyncOk: failures.length === 0,
        lastSyncMessage:
          `${result.teams} times e ${result.players} jogadores vieram do SoFIFA.` +
          (failures.length ? ` ${failures.length} clube(s) não encontrados.` : ''),
      },
    });

    return {
      ...result,
      failures,
      filled: squads.map((squad) => squad.name),
      remaining,
    };
  }

  /// O time importado da liga já guarda o id do SoFIFA em `externalId`, e por
  /// ele a busca é direta. Só quem foi criado à mão precisa procurar pelo nome,
  /// que é onde mora o risco de cair no clube errado.
  private async sofifaSquad(team: { name: string; externalId: string | null }) {
    const id = Number(team.externalId);
    return Number.isFinite(id) && id > 0
      ? this.sofifa.fetchSquad(id, team.name)
      : this.sofifa.fetchSquadByName(team.name);
  }

  /// Relê todos os clubes da competição, não só os vazios.
  private async refreshFromSofifa(competitionId: string) {
    const teams = await this.prisma.catalogTeam.findMany({
      where: { competitionId },
      orderBy: [{ syncedAt: 'asc' }, { name: 'asc' }],
      take: MAX_SOFIFA_TEAMS,
    });
    if (teams.length === 0) {
      throw new BadRequestException('Esta competição ainda não tem nenhum time.');
    }

    const squads: SyncedTeam[] = [];
    const failures: string[] = [];
    for (const team of teams) {
      try {
        const squad = await this.sofifaSquad(team);
        squads.push({
          externalId: String(squad.teamId),
          name: team.name,
          shortName: null,
          crestUrl: null,
          players: squad.players.map(toSyncedPlayer),
        });
      } catch (error) {
        failures.push(`${team.name}: ${(error as Error)?.message ?? 'erro desconhecido'}`);
      }
    }
    if (squads.length === 0) throw new BadRequestException(failures.join(' | '));

    const result = await this.persist(competitionId, squads, CatalogSource.SOFIFA);
    await this.prisma.catalogCompetition.update({
      where: { id: competitionId },
      data: {
        lastSyncAt: new Date(),
        lastSyncOk: failures.length === 0,
        lastSyncMessage:
          `${result.teams} times e ${result.players} jogadores relidos do SoFIFA.` +
          (failures.length ? ` ${failures.length} clube(s) não encontrados.` : ''),
      },
    });
    return { ...result, failures };
  }

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

    /// No SoFIFA atualizar é reler a página de cada clube, inclusive os que já
    /// têm elenco: é assim que a base pega a atualização de nota do jogo.
    if (competition.source === CatalogSource.SOFIFA) {
      return this.refreshFromSofifa(competitionId);
    }

    /// Wikipedia e IA não têm endpoint de competição: atualizar é refazer a
    /// pergunta para os clubes que já estão aqui. A IA pega só os três mais
    /// desatualizados por vez, pelo mesmo motivo que `fillCompetition`.
    if (
      competition.source === CatalogSource.WIKIPEDIA ||
      competition.source === CatalogSource.AI
    ) {
      const isAi = competition.source === CatalogSource.AI;
      const registered = await this.prisma.catalogTeam.findMany({
        where: { competitionId },
        orderBy: [{ syncedAt: 'asc' }, { name: 'asc' }],
        select: { name: true },
      });
      if (registered.length === 0) {
        throw new BadRequestException(
          'Esta origem ainda não tem nenhum time. Envie a lista de clubes primeiro.',
        );
      }

      const names = registered.map((team) => team.name);
      return isAi
        ? this.syncAiSquads(
            { teams: names.slice(0, DEFAULT_AI_FILL_BATCH) },
            competitionId,
          )
        : this.syncWikipedia(names, competitionId);
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

  async syncWikipedia(names: string[], competitionId?: string) {
    const teams = [
      ...new Set(names.map((name) => name.trim()).filter(Boolean)),
    ];
    if (teams.length === 0)
      throw new BadRequestException(
        'Informe ao menos um time para buscar na Wikipedia.',
      );

    const competition = competitionId
      ? await this.prisma.catalogCompetition.findUniqueOrThrow({
          where: { id: competitionId },
        })
      : await this.prisma.catalogCompetition.upsert({
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

  /// A IA diz quais clubes disputam a competição e eles entram como pastas
  /// vazias. Os elencos ficam para `fillCompetition`, em chamadas separadas:
  /// vinte clubes numa requisição só passam de dez minutos e o navegador corta.
  async createAiCompetition(input: {
    name: string;
    code?: string;
    referenceDate?: string;
  }) {
    const found = await this.aiSquad.fetchCompetitionTeams(
      input.name,
      input.referenceDate,
    );

    const code = (input.code?.trim() || slugCode(input.name)).toUpperCase();
    const competition = await this.prisma.catalogCompetition.upsert({
      where: { code },
      update: {
        name: input.name,
        country: found.country,
        source: CatalogSource.AI,
      },
      create: {
        code,
        name: input.name,
        country: found.country,
        source: CatalogSource.AI,
      },
    });

    const syncedAt = new Date();
    let created = 0;
    for (const team of found.teams) {
      const existing = await this.prisma.catalogTeam.findUnique({
        where: {
          competitionId_name: {
            competitionId: competition.id,
            name: team.name,
          },
        },
      });
      if (existing) continue;
      await this.prisma.catalogTeam.create({
        data: {
          competitionId: competition.id,
          name: team.name,
          shortName: team.shortName,
          source: CatalogSource.AI,
          syncedAt,
        },
      });
      created++;
    }

    return {
      competition,
      teams: found.teams,
      created,
      season: found.season,
      beyondKnowledge: found.beyondKnowledge,
      notes: found.notes,
      model: found.model,
    };
  }

  /// Um time só, uma chamada de modelo: é o botão de preencher da linha do time.
  async fillTeamWithAi(teamId: string, referenceDate?: string) {
    const team = await this.prisma.catalogTeam.findUniqueOrThrow({
      where: { id: teamId },
      include: { competition: { select: { id: true, name: true } } },
    });

    const result = await this.syncAiSquads(
      {
        teams: [team.name],
        referenceDate,
        competition: team.competition.name,
      },
      team.competition.id,
    );

    return { ...result, team: team.name };
  }

  /// Preenche os times vazios de uma competição em lotes curtos, para cada
  /// requisição caber no tempo do navegador. Quem chama repete enquanto sobrar
  /// gente em `remaining`.
  async fillCompetition(
    competitionId: string,
    input: { referenceDate?: string; limit?: number },
  ) {
    const competition = await this.prisma.catalogCompetition.findUniqueOrThrow({
      where: { id: competitionId },
    });
    const limit = Math.min(
      Math.max(input.limit ?? DEFAULT_AI_FILL_BATCH, 1),
      MAX_AI_FILL_BATCH,
    );

    const empty = await this.prisma.catalogTeam.findMany({
      where: { competitionId, players: { none: { active: true } } },
      orderBy: { name: 'asc' },
      select: { name: true },
    });
    if (empty.length === 0) {
      return {
        teams: 0,
        players: 0,
        failures: [],
        squads: [],
        filled: [],
        remaining: 0,
      };
    }

    const batch = empty.slice(0, limit).map((team) => team.name);
    const result = await this.syncAiSquads(
      {
        teams: batch,
        referenceDate: input.referenceDate,
        competition: competition.name,
      },
      competitionId,
    );

    return {
      ...result,
      filled: batch,
      remaining: Math.max(0, empty.length - batch.length),
    };
  }

  /// Elenco vindo da memória do modelo, para clube que a Wikipedia não cobre bem.
  /// Emprestado e garoto da base ficam de fora: o que interessa é o grupo principal.
  async syncAiSquads(
    input: {
      teams: string[];
      referenceDate?: string;
      competition?: string | null;
    },
    competitionId?: string,
  ) {
    const batch = await this.aiSquad.fetchSquads(
      input.teams,
      input.referenceDate,
      input.competition,
    );

    const competition = competitionId
      ? await this.prisma.catalogCompetition.findUniqueOrThrow({
          where: { id: competitionId },
        })
      : await this.prisma.catalogCompetition.upsert({
          where: { code: AI_CODE },
          update: { name: 'Elencos pela IA', source: CatalogSource.AI },
          create: {
            code: AI_CODE,
            name: 'Elencos pela IA',
            source: CatalogSource.AI,
          },
        });

    /// O time fica com o nome que foi pedido, não com o nome oficial que o
    /// modelo devolveu: é esse nome que volta na próxima atualização.
    const squads: SyncedTeam[] = batch.squads.map((squad) => ({
      externalId: null,
      name: squad.team,
      shortName: null,
      crestUrl: null,
      players: squad.players
        .filter(
          (player) =>
            !player.onLoan &&
            !player.fromYouth &&
            player.confidence >= MIN_AI_CONFIDENCE,
        )
        .map((player) => ({
          externalId: null,
          name: player.name,
          position: player.position,
          shirtNumber: player.shirtNumber,
          nationality: player.nationality,
          birthDate: player.birthDate
            ? new Date(`${player.birthDate}T00:00:00Z`)
            : null,
          card:
            player.attributes && player.overall !== null
              ? {
                  attributes: player.attributes,
                  overall: player.overall,
                  model: squad.model,
                  note: player.note || null,
                }
              : null,
        })),
    }));

    const result = await this.persist(competition.id, squads, CatalogSource.AI);
    /// A data pedida costuma passar do que o modelo conhece. Isso não invalida a
    /// importação, mas fica registrado aqui, senão ninguém lembra depois.
    const outdated = batch.squads
      .filter((squad) => squad.beyondKnowledge)
      .map((squad) => squad.team);
    const message = [
      `${result.teams} times e ${result.players} jogadores atualizados.`,
      batch.failures.length
        ? `${batch.failures.length} time(s) sem elenco.`
        : '',
      outdated.length
        ? `Elenco anterior à data pedida em: ${outdated.join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    await this.prisma.catalogCompetition.update({
      where: { id: competition.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncOk: batch.failures.length === 0,
        lastSyncMessage: message.slice(0, 240),
      },
    });

    return {
      ...result,
      failures: batch.failures,
      squads: batch.squads,
    };
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
              shirtNumber: normalizeShirtNumber(player.shirtNumber),
              nationality: player.nationality ?? null,
              birthDate: player.dateOfBirth
                ? new Date(player.dateOfBirth)
                : null,
              card: null,
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
        shirtNumber: player.shirtNumber,
        nationality: player.nationality,
        birthDate: null,
        card: null,
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
              shirtNumber: normalizeShirtNumber(
                player.shirtNumber ?? player.number ?? player.squadNumber,
              ),
              nationality: player.nationality ?? null,
              birthDate: player.dateOfBirth
                ? new Date(player.dateOfBirth)
                : null,
              card: null,
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
        const existing = await this.prisma.catalogPlayer.findUnique({
          where: { teamId_name: { teamId: saved.id, name: player.name } },
          select: { id: true, pace: true, attributesModel: true },
        });
        const card = cardData(player, existing, syncedAt);

        if (existing) {
          await this.prisma.catalogPlayer.update({
            where: { id: existing.id },
            data: {
              externalId: player.externalId,
              position: player.position,
              shirtNumber: player.shirtNumber,
              nationality: player.nationality,
              birthDate: player.birthDate,
              active: true,
              source,
              syncedAt,
              ...card,
            },
          });
        } else {
          await this.prisma.catalogPlayer.create({
            data: {
              teamId: saved.id,
              externalId: player.externalId,
              name: player.name,
              position: player.position,
              shirtNumber: player.shirtNumber,
              nationality: player.nationality,
              birthDate: player.birthDate,
              source,
              syncedAt,
              ...card,
            },
          });
        }
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

/// O card do modelo entra quando o jogador ainda não tem atributo ou quando os
/// que ele tem também vieram de um modelo. Número ajustado na mão fica de pé:
/// ali `attributesModel` é nulo com atributo preenchido.
function cardData(
  player: SyncedPlayer,
  existing: { pace: number | null; attributesModel: string | null } | null,
  syncedAt: Date,
) {
  if (!player.card) return {};
  const handEdited =
    existing !== null &&
    existing.pace !== null &&
    existing.attributesModel === null;
  if (handEdited) return {};

  return {
    ...player.card.attributes,
    overall: player.card.overall,
    price: marketValueFor(player.card.overall),
    attributesModel: player.card.model,
    attributesNote: player.card.note,
    attributesAt: syncedAt,
  };
}

/// O card vem medido do jogo, então entra como está. O preço continua saindo da
/// nossa tabela: o valor em euro do site é de outra escala e desequilibraria o
/// orçamento do draft.
function toSyncedPlayer(player: SofifaPlayer): SyncedPlayer {
  return {
    externalId: player.sofifaId,
    name: player.name,
    position: player.position,
    shirtNumber: null,
    nationality: null,
    birthDate: null,
    card: player.attributes
      ? {
          attributes: player.attributes,
          overall: player.overall,
          model: 'SoFIFA FC 26',
          note: null,
        }
      : null,
  };
}

/// Código da competição a partir do nome, no formato que o cadastro aceita.
function slugCode(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  return slug.length >= 2 ? slug : `LIGA_${Date.now().toString().slice(-6)}`;
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
