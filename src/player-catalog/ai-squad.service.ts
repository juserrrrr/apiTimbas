import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiSettingsService } from '../ai/ai-settings.service';
import {
  ChatClient,
  describeAiError,
  parseJsonObject,
} from '../ai/chat.client';
import {
  ATTRIBUTE_KEYS,
  PlayerAttributes,
  clampAttribute,
  overallFromAttributes,
} from '../football/attributes';
import { marketValueFor } from '../football/market-value';
import {
  CATALOG_POSITIONS,
  normalizePosition,
  normalizeShirtNumber,
} from './position.mapper';

export interface AiSquadPlayer {
  shirtNumber: number | null;
  name: string;
  position: string;
  rawPosition: string | null;
  nationality: string | null;
  birthDate: string | null;
  onLoan: boolean;
  fromYouth: boolean;
  confidence: number;
  /// Nulo quando o modelo não devolveu os seis atributos do card.
  attributes: PlayerAttributes | null;
  overall: number | null;
  price: number | null;
  note: string;
}

export interface AiSquadResult {
  team: string;
  teamName: string | null;
  competition: string | null;
  coach: string | null;
  referenceDate: string;
  players: AiSquadPlayer[];
  /// O modelo avisou que a data pedida passa do que ele conhece.
  beyondKnowledge: boolean;
  notes: string;
  provider: string;
  model: string;
}

export interface AiSquadBatch {
  squads: AiSquadResult[];
  failures: string[];
}

export interface AiCompetitionTeam {
  name: string;
  shortName: string | null;
  country: string | null;
}

export interface AiCompetitionResult {
  competition: string;
  season: string | null;
  country: string | null;
  teams: AiCompetitionTeam[];
  beyondKnowledge: boolean;
  notes: string;
  provider: string;
  model: string;
}

const SYSTEM_PROMPT =
  'Você é um pesquisador de futebol que lista elencos de clubes de memória e um scout que traduz o nível de cada jogador para os atributos do card do EA FC. Responda somente com JSON válido. Prefira deixar um campo nulo a inventar um dado. Nunca use travessão nos textos.';

/// Um elenco profissional passa de trinta nomes, e cada um traz camisa, ficha e
/// os seis atributos. Menos que isso e a resposta chega cortada no meio.
const MAX_TOKENS = 8192;

@Injectable()
export class AiSquadService {
  private readonly logger = new Logger(AiSquadService.name);

  constructor(
    private readonly settings: AiSettingsService,
    private readonly chat: ChatClient,
  ) {}

  /// Os clubes que disputam uma competição numa data. É o passo antes dos
  /// elencos, para o admin não precisar digitar vinte nomes na mão.
  async fetchCompetitionTeams(
    competition: string,
    referenceDate?: string,
  ): Promise<AiCompetitionResult> {
    const { provider, fallbackProvider } = await this.requireProvider();
    const date = resolveDate(referenceDate);

    let answer: string;
    try {
      answer = await this.chat.complete({
        provider,
        fallbackProvider,
        system: SYSTEM_PROMPT,
        prompt: buildCompetitionPrompt(competition, date),
        json: true,
        temperature: 0,
        maxTokens: 2048,
      });
    } catch (error) {
      const message = describeAiError(error);
      this.logger.warn(
        `Falha ao listar os clubes de ${competition}: ${message}`,
      );
      throw new BadRequestException(
        `Não foi possível listar os clubes de ${competition}: ${message}`,
      );
    }

    const parsed = parseAiCompetition(answer);
    if (!parsed || parsed.teams.length === 0) {
      throw new BadRequestException(
        `A IA não devolveu os clubes de ${competition} nessa data.`,
      );
    }

    return {
      ...parsed,
      competition: parsed.competition ?? competition,
      provider: provider.id,
      model: provider.model,
    };
  }

  async fetchSquads(
    teams: string[],
    referenceDate?: string,
    competition?: string | null,
  ): Promise<AiSquadBatch> {
    const names = [
      ...new Set(teams.map((team) => team.trim()).filter(Boolean)),
    ];
    if (names.length === 0) {
      throw new BadRequestException('Informe ao menos um time.');
    }

    const { provider, fallbackProvider } = await this.requireProvider();
    const date = resolveDate(referenceDate);
    const squads: AiSquadResult[] = [];
    const failures: string[] = [];

    for (const team of names) {
      try {
        const answer = await this.chat.complete({
          provider,
          fallbackProvider,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(team, date, competition),
          json: true,
          temperature: 0,
          maxTokens: MAX_TOKENS,
        });

        const parsed = parseAiSquad(answer);
        if (!parsed || parsed.players.length === 0) {
          failures.push(
            `${team}: o modelo não devolveu um elenco legível para essa data.`,
          );
          continue;
        }

        squads.push({
          ...parsed,
          team,
          referenceDate: date,
          provider: provider.id,
          model: provider.model,
        });
      } catch (error) {
        const message = describeAiError(error);
        this.logger.warn(`Falha ao buscar o elenco de ${team}: ${message}`);
        failures.push(`${team}: ${message}`);
      }
    }

    if (squads.length === 0) {
      throw new BadRequestException(
        failures.join(' | ') || 'Nenhum elenco foi devolvido pela IA.',
      );
    }

    return { squads, failures };
  }

  private async requireProvider() {
    const { provider, fallbackProvider, unavailableReason } =
      await this.settings.analysis();
    if (!provider) {
      throw new BadRequestException(
        unavailableReason ??
          'IA indisponível. Configure o provedor no painel de administração.',
      );
    }
    return { provider, fallbackProvider };
  }
}

function resolveDate(referenceDate?: string): string {
  const date = referenceDate?.trim();
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Date().toISOString().slice(0, 10);
}

function buildPrompt(
  team: string,
  date: string,
  competition?: string | null,
): string {
  return `Liste o elenco profissional do ${team} na data ${date}${
    competition ? `, que disputa ${competition}` : ''
  }.

Responda APENAS neste formato:
{
  "teamName": "nome oficial do clube",
  "competition": "principal competição nacional dele ou null",
  "coach": "técnico na data ou null",
  "beyondKnowledge": false,
  "players": [
    {
      "shirtNumber": 10,
      "name": "nome pelo qual ele é conhecido",
      "position": "GOL",
      "nationality": "Brasil",
      "birthDate": "1997-03-15",
      "onLoan": false,
      "fromYouth": false,
      "confidence": 90,
      "pace": 0, "shooting": 0, "passing": 0, "dribbling": 0, "defending": 0, "physical": 0,
      "overall": 0,
      "note": "uma frase curta sobre o jogador, máx 120 caracteres"
    }
  ],
  "notes": "o que ficou incerto, máx 200 caracteres"
}

Regras:
- Liste TODOS os jogadores do elenco principal, dos goleiros aos atacantes, na ordem de posição.
- position tem que ser uma destas siglas: ${CATALOG_POSITIONS.join(', ')}.
- birthDate no formato AAAA-MM-DD, ou null se você não souber a data exata.
- Use null em qualquer campo que você não saiba. Palpite em campo de dado é erro.
- confidence vai de 0 a 100 e mede a certeza de que esse jogador estava no elenco nessa data.
- onLoan é true para quem está emprestado a outro clube, fromYouth é true para quem subiu da base e ainda não é do grupo principal. Inclua os dois, marcados.
- Os seis atributos vão de 1 a 99, na escala do EA FC, pelo nível do jogador nessa data.
- Para jogador de linha eles são ritmo (pace), finalização (shooting), passe (passing), drible (dribbling), defesa (defending) e físico (physical).
- Para goleiro as mesmas chaves valem, na ordem: pace = elasticidade, shooting = manejo, passing = chute, dribbling = reflexos, defending = velocidade, physical = posicionamento.
- overall precisa ser coerente com os atributos e com a posição.
- Se ${date} for depois do que você conhece, marque beyondKnowledge como true, devolva o elenco mais recente que você conhece e diga em notes até quando o seu conhecimento vai.
- Não invente jogador. É melhor devolver menos gente do que devolver gente que não estava lá.`;
}

function buildCompetitionPrompt(competition: string, date: string): string {
  return `Liste os clubes que disputavam ${competition} na data ${date}.

Responda APENAS neste formato:
{
  "competition": "nome oficial da competição",
  "season": "temporada, por exemplo 2026 ou 2025-26",
  "country": "país ou null",
  "beyondKnowledge": false,
  "teams": [{ "name": "nome curto pelo qual o clube é conhecido", "shortName": "sigla de até 4 letras ou null", "country": "país ou null" }],
  "notes": "o que ficou incerto, máx 200 caracteres"
}

Regras:
- Liste todos os clubes da divisão principal daquela temporada, sem repetir.
- name é o nome curto e usual do clube, o mesmo que a torcida usa, não a razão social.
- Se ${date} for depois do que você conhece, marque beyondKnowledge como true, devolva a temporada mais recente que você conhece e diga em notes qual é ela.
- Não invente clube. É melhor devolver a lista menor do que devolver clube que não estava lá.`;
}

export function parseAiCompetition(text: string):
  | (Omit<AiCompetitionResult, 'provider' | 'model' | 'competition'> & {
      competition: string | null;
    })
  | null {
  const parsed = parseJsonObject(text);
  if (!parsed || !Array.isArray(parsed.teams)) return null;

  const seen = new Set<string>();
  const teams = (parsed.teams as Array<Record<string, unknown>>)
    .map((row) => ({
      name: typeof row?.name === 'string' ? row.name.trim().slice(0, 60) : '',
      shortName: toText(row?.shortName, 8)?.toUpperCase() ?? null,
      country: toText(row?.country, 40),
    }))
    .filter((team) => {
      if (team.name.length < 2) return false;
      const key = team.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    competition: toText(parsed.competition, 80),
    season: toText(parsed.season, 20),
    country: toText(parsed.country, 40),
    teams,
    beyondKnowledge: parsed.beyondKnowledge === true,
    notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 240) : '',
  };
}

/// A resposta do modelo é entrada de fora: nada aqui confia no formato.
export function parseAiSquad(
  text: string,
): Omit<AiSquadResult, 'team' | 'referenceDate' | 'provider' | 'model'> | null {
  const parsed = parseJsonObject(text);
  if (!parsed || !Array.isArray(parsed.players)) return null;

  const seen = new Set<string>();
  const players = (parsed.players as Array<Record<string, unknown>>)
    .map((row) => {
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      const rawPosition =
        typeof row?.position === 'string' ? row.position.trim() || null : null;
      const position = normalizePosition(rawPosition);
      const attributes = toAttributes(row);
      const overall = attributes
        ? (clampAttribute(row?.overall) ??
          overallFromAttributes(position, attributes))
        : clampAttribute(row?.overall);

      return {
        shirtNumber: normalizeShirtNumber(row?.shirtNumber),
        name,
        position,
        rawPosition,
        nationality: toText(row?.nationality, 40),
        birthDate: toIsoDate(row?.birthDate),
        onLoan: row?.onLoan === true,
        fromYouth: row?.fromYouth === true,
        confidence: toConfidence(row?.confidence),
        attributes,
        overall,
        price: overall === null ? null : marketValueFor(overall),
        note: typeof row?.note === 'string' ? row.note.slice(0, 160) : '',
      };
    })
    .filter((player) => {
      if (player.name.length < 2) return false;
      const key = player.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    teamName: toText(parsed.teamName, 60),
    competition: toText(parsed.competition, 60),
    coach: toText(parsed.coach, 60),
    beyondKnowledge: parsed.beyondKnowledge === true,
    players,
    notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 240) : '',
  };
}

/// Ou vêm os seis atributos, ou não vem nenhum: card pela metade não serve para
/// simular partida nem para precificar o jogador.
function toAttributes(row: Record<string, unknown>): PlayerAttributes | null {
  const values = ATTRIBUTE_KEYS.map((key) => clampAttribute(row?.[key]));
  if (values.some((value) => value === null)) return null;
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((key, index) => [key, values[index]!]),
  ) as PlayerAttributes;
}

function toConfidence(raw: unknown): number {
  const value = Math.round(Number(raw));
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function toText(raw: unknown, max: number): string | null {
  return typeof raw === 'string' && raw.trim()
    ? raw.trim().slice(0, max)
    : null;
}

function toIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim()))
    return null;
  const date = raw.trim();
  return Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()) ? null : date;
}
