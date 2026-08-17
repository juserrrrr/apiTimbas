/// Leitor de elenco da Wikipédia.
///
/// O artigo de todo clube grande lista o elenco com o template {{Fs player}},
/// dentro de uma seção de elenco. O que muda de clube para clube é a arrumação
/// das seções, e são dois jeitos comuns:
///
///   ==Players==            ==Current squad==
///   ===First-team squad=== ===First team===
///
/// Por isso quem decide é a seção mais funda que tem opinião: olhamos da seção do
/// jogador para cima e paramos na primeira que fala de elenco ou que fala de
/// empréstimo, base e número aposentado. O filho manda no pai, senão o Corinthians
/// volta vazio, porque o elenco dele mora dentro de "Players and staff" e o "staff"
/// derrubaria a seção inteira. E o pai não pode mandar no filho, senão o Flamengo
/// traz quem está emprestado como se estivesse no elenco.

export interface WikiSquadPlayer {
  name: string;
  position: string | null;
  nationality: string | null;
  shirtNumber: number | null;
}

const HEADING = /^(={2,})\s*(.+?)\s*\1\s*$/gm;
const SQUAD_SECTION = /squad|contract|first[\s-]?team|elenco/i;
const NOT_SQUAD_SECTION =
  /loan|retired|youth|reserve|academy|women|former|notable|statistic|transfer|staff/i;

/// Tira os jogadores do texto cru do artigo.
export function parseSquadWikitext(wikitext: string): WikiSquadPlayer[] {
  const sections = splitSections(wikitext);
  const players: WikiSquadPlayer[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    if (!isSquadSection(section.trail)) continue;

    for (const template of findTemplates(section.body, 'fs player')) {
      const fields = parseFields(template);
      const name = cleanName(fields.name ?? '');
      if (!name) continue;

      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      players.push({
        name,
        position: cleanValue(fields.pos) || null,
        nationality: cleanValue(fields.nat) || null,
        shirtNumber: toNumber(fields.no),
      });
    }
  }

  return players;
}

interface Section {
  /// A seção e todas as que estão acima dela, da mais externa para a mais interna.
  trail: string[];
  body: string;
}

function splitSections(wikitext: string): Section[] {
  const heads: Array<{
    level: number;
    title: string;
    start: number;
    end: number;
  }> = [];
  HEADING.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEADING.exec(wikitext)) !== null) {
    heads.push({
      level: match[1].length,
      title: match[2],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  const sections: Section[] = [];
  const stack: Array<{ level: number; title: string }> = [];

  for (const [index, head] of heads.entries()) {
    while (stack.length > 0 && stack[stack.length - 1].level >= head.level)
      stack.pop();
    stack.push({ level: head.level, title: head.title });

    const stop =
      index + 1 < heads.length ? heads[index + 1].start : wikitext.length;
    sections.push({
      trail: stack.map((item) => item.title),
      body: wikitext.slice(head.end, stop),
    });
  }

  return sections;
}

function isSquadSection(trail: string[]): boolean {
  if (trail.some((title) => NOT_SQUAD_SECTION.test(title))) return false;
  return trail.some((title) => SQUAD_SECTION.test(title));
}

/// Acha os templates pelo nome contando as chaves, porque um {{Fs player}} pode
/// ter outro template dentro, no campo "other".
function findTemplates(text: string, name: string): string[] {
  const found: string[] = [];
  const opener = new RegExp(`\\{\\{\\s*${name}\\b`, 'gi');
  let match: RegExpExecArray | null;

  while ((match = opener.exec(text)) !== null) {
    let depth = 0;
    let index = match.index;
    for (; index < text.length; index += 1) {
      if (text.startsWith('{{', index)) {
        depth += 1;
        index += 1;
      } else if (text.startsWith('}}', index)) {
        depth -= 1;
        index += 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;
    found.push(text.slice(match.index + 2, index - 1));
    opener.lastIndex = index;
  }

  return found;
}

/// Separa os campos no pipe de nível zero: o pipe de dentro de [[link|texto]] ou
/// de um template aninhado não separa campo nenhum.
function parseFields(body: string): Record<string, string> {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (let index = 0; index < body.length; index += 1) {
    if (body.startsWith('[[', index) || body.startsWith('{{', index)) {
      depth += 1;
      current += body.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (body.startsWith(']]', index) || body.startsWith('}}', index)) {
      depth -= 1;
      current += body.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (body[index] === '|' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += body[index];
  }
  parts.push(current);

  const fields: Record<string, string> = {};
  for (const part of parts) {
    const split = part.indexOf('=');
    if (split < 0) continue;
    const key = part.slice(0, split).trim().toLowerCase();
    if (key) fields[key] = part.slice(split + 1).trim();
  }
  return fields;
}

/// O nome vem como [[Página|Apelido]], [[Nome]] ou texto puro, e a página muitas
/// vezes é desambiguada: [[Fábio (footballer, born 1980)]] tem que virar Fábio.
function cleanName(raw: string): string {
  let name = raw.trim();

  const link = /\[\[([^\]]+)\]\]/.exec(name);
  if (link) {
    const inside = link[1];
    const pipe = inside.indexOf('|');
    name = pipe >= 0 ? inside.slice(pipe + 1) : inside;
  }

  return name
    .replace(/\([^)]*\)/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanValue(raw: string | undefined): string {
  return (raw ?? '')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function toNumber(raw: string | undefined): number | null {
  const value = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(value) ? value : null;
}
