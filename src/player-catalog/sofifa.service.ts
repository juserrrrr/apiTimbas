import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ATTRIBUTE_KEYS, PlayerAttributes } from '../football/attributes';
import { normalizePosition } from './position.mapper';

export interface SofifaPlayer {
  sofifaId: string | null;
  name: string;
  position: string;
  overall: number;
  /// Em euros, como o site publica. Nulo quando a coluna vem vazia.
  value: number | null;
  attributes: PlayerAttributes | null;
}

export interface SofifaSquad {
  teamId: number;
  teamName: string;
  players: SofifaPlayer[];
}

export interface SofifaLeague {
  id: number;
  name: string;
  country: string | null;
}

export interface SofifaTeam {
  id: number;
  name: string;
}

const BASE_URL = 'https://sofifa.com';
/// Um clube tem trinta e poucos jogadores e a listagem devolve sessenta por
/// página, então uma página basta. O corte existe para não varrer o site inteiro
/// se o filtro falhar e vier a base toda.
const MAX_PLAYERS = 60;
/// As colunas do card, na ordem do EA FC, mais nota, valor, id e time.
const COLUMNS = ['pi', 'oa', 'vl', 'tm', 'pac', 'sho', 'pas', 'dri', 'def', 'phy'];
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

/// O índice de ligas muda uma vez por ano, então vale guardar por um tempo em
/// vez de rebaixar a página a cada busca.
const LEAGUES_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class SofifaService {
  private readonly logger = new Logger(SofifaService.name);
  private leagues: { at: number; items: SofifaLeague[] } | null = null;

  /// O clube pelo nome. A busca devolve os parecidos, e fica o primeiro, que é
  /// como o próprio site ordena por relevância.
  async findTeam(name: string): Promise<{ id: number; name: string }> {
    const html = await this.get('/teams', { keyword: name });
    const match = /href="\/team\/(\d+)\/[^"]*"[^>]*>([^<]+)</.exec(html);
    if (!match) {
      throw new BadRequestException(`O SoFIFA não achou nenhum clube chamado "${name}".`);
    }
    return { id: Number(match[1]), name: decodeEntities(match[2].trim()) };
  }

  async fetchSquad(teamId: number, teamName: string): Promise<SofifaSquad> {
    const html = await this.get('/players', {
      'tm[0]': String(teamId),
      ...Object.fromEntries(COLUMNS.map((column, index) => [`showCol[${index}]`, column])),
    });

    const players = parseSquadHtml(html).slice(0, MAX_PLAYERS);
    if (players.length === 0) {
      throw new BadRequestException(`O SoFIFA não listou jogadores para ${teamName}.`);
    }
    return { teamId, teamName, players };
  }

  async fetchSquadByName(name: string): Promise<SofifaSquad> {
    const team = await this.findTeam(name);
    return this.fetchSquad(team.id, team.name);
  }

  async listLeagues(): Promise<SofifaLeague[]> {
    if (this.leagues && Date.now() - this.leagues.at < LEAGUES_TTL_MS) {
      return this.leagues.items;
    }
    const items = parseLeaguesHtml(await this.get('/leagues', {}));
    this.leagues = { at: Date.now(), items };
    return items;
  }

  /// A liga pelo nome. Vários campeonatos se chamam Série A, por isso o país
  /// também entra na comparação.
  async findLeague(name: string): Promise<SofifaLeague> {
    const leagues = await this.listLeagues();
    const wanted = simplify(name);
    const match =
      leagues.find((league) => simplify(`${league.name} ${league.country ?? ''}`) === wanted) ??
      leagues.find((league) => simplify(league.name) === wanted) ??
      leagues.find((league) => wanted.includes(simplify(league.name))) ??
      leagues.find((league) => simplify(league.name).includes(wanted));

    if (!match) {
      /// Sugerir o que existe evita o vaivém de adivinhar o nome: o Brasileirão,
      /// por exemplo, se chama Série A lá.
      const close = leagues
        .filter((league) => simplify(league.country ?? '').includes(wanted.split(' ')[0] ?? ''))
        .slice(0, 4)
        .map((league) => `${league.name} (${league.country})`);
      throw new BadRequestException(
        `O SoFIFA não tem liga chamada "${name}".` +
          (close.length ? ` Talvez seja: ${close.join(', ')}.` : ` Ele cobre ${leagues.length} ligas do jogo.`),
      );
    }
    return match;
  }

  async fetchLeagueTeams(leagueId: number): Promise<SofifaTeam[]> {
    const html = await this.get('/teams', { 'lg[0]': String(leagueId) });
    const teams = new Map<number, string>();
    for (const match of html.matchAll(/href="\/team\/(\d+)\/[^"]*"[^>]*>([^<]+)</g)) {
      const id = Number(match[1]);
      const name = decodeEntities(match[2].trim());
      if (name.length >= 2 && !teams.has(id)) teams.set(id, name);
    }
    return [...teams].map(([id, name]) => ({ id, name }));
  }

  private async get(path: string, params: Record<string, string>): Promise<string> {
    try {
      const response = await axios.get(`${BASE_URL}${path}`, {
        params: { hl: 'pt-BR', ...params },
        headers: HEADERS,
        timeout: 30000,
        responseType: 'text',
      });
      return String(response.data);
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      this.logger.warn(`Falha no SoFIFA ${path}: ${status ?? (error as Error)?.message}`);
      if (status === 403 || status === 429) {
        throw new BadRequestException('O SoFIFA recusou a consulta. Tente de novo em alguns minutos.');
      }
      throw new BadRequestException('Não foi possível falar com o SoFIFA agora.');
    }
  }
}

/// A tabela do SoFIFA muda de ordem conforme as colunas pedidas, então quem
/// manda é o cabeçalho: cada coluna é reconhecida pelo rótulo, não pela posição.
export function parseSquadHtml(html: string): SofifaPlayer[] {
  const head = /<thead[\s\S]*?<\/thead>/i.exec(html);
  if (!head) return [];

  const labels = [...head[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((cell) =>
    stripTags(cell[1]).toLowerCase(),
  );
  const column = (test: RegExp) => labels.findIndex((label) => test.test(label));

  /// "Defesa / Ritmo" e "Ritmo / Elasticidade" têm a mesma palavra, por isso a
  /// defesa é procurada antes do ritmo.
  const index = {
    overall: column(/classifica|geral/),
    value: column(/valor/),
    sofifaId: column(/^\s*id\s*$/),
    defending: column(/defesa/),
    physical: column(/f[ií]sico/),
    shooting: column(/finaliz/),
    passing: column(/passes/),
    dribbling: column(/condu/),
    pace: labels.findIndex((label, position) => /ritmo/.test(label) && position !== column(/defesa/)),
  };

  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].slice(1);
  const players: SofifaPlayer[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length < 3) continue;

    const nameCell = cells.find((cell) => /href="\/player\//.test(cell));
    if (!nameCell) continue;

    const name = decodeEntities(stripTags(/<a[^>]*>([\s\S]*?)<\/a>/i.exec(nameCell)?.[1] ?? ''));
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const attributes = Object.fromEntries(
      ATTRIBUTE_KEYS.map((attribute) => [attribute, numberAt(cells, index[attribute])]),
    ) as Record<keyof PlayerAttributes, number | null>;
    const complete = ATTRIBUTE_KEYS.every((attribute) => attributes[attribute] !== null);

    players.push({
      sofifaId: textAt(cells, index.sofifaId) || null,
      name,
      /// A primeira sigla é a posição principal, as outras são as alternativas.
      position: normalizePosition(firstPosition(nameCell)),
      overall: numberAt(cells, index.overall) ?? 70,
      value: parseMoney(textAt(cells, index.value)),
      attributes: complete ? (attributes as PlayerAttributes) : null,
    });
  }

  return players;
}

/// O índice de ligas: cada linha tem o link com o id, o nome e a bandeira do
/// país, e é o país que separa as várias "Série A" do mundo.
export function parseLeaguesHtml(html: string): SofifaLeague[] {
  const leagues: SofifaLeague[] = [];

  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const link = /href="\/league\/(\d+)[^"]*"[^>]*>([^<]+)</.exec(row[1]);
    if (!link) continue;
    const country = /title="([^"]+)"/.exec(row[1]);
    leagues.push({
      id: Number(link[1]),
      name: decodeEntities(link[2].trim()),
      country: country ? decodeEntities(country[1].trim()) : null,
    });
  }

  return leagues;
}

/// Compara nome de liga sem acento, sem caixa e sem pontuação.
function simplify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function firstPosition(nameCell: string): string | null {
  const match = /<span[^>]*class="[^"]*pos[^"]*"[^>]*>([^<]+)<\/span>/i.exec(nameCell);
  return match ? match[1].trim() : null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textAt(cells: string[], index: number): string {
  if (index < 0 || index >= cells.length) return '';
  return decodeEntities(stripTags(cells[index]));
}

function numberAt(cells: string[], index: number): number | null {
  const value = Number.parseInt(textAt(cells, index), 10);
  return Number.isFinite(value) ? value : null;
}

/// O site escreve o valor como €147M ou €72.5M, e às vezes em milhares.
export function parseMoney(raw: string): number | null {
  const match = /([\d.,]+)\s*([MK])?/i.exec(raw.replace(/[^\d.,MK]/gi, ''));
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount === 0) return null;
  const scale = match[2]?.toUpperCase() === 'M' ? 1_000_000 : match[2]?.toUpperCase() === 'K' ? 1_000 : 1;
  return Math.round(amount * scale);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}
