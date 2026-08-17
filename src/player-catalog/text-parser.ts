import { normalizePosition } from './position.mapper';

export interface ParsedPlayerLine {
  name: string;
  position: string;
  overall: number | null;
  realTeam: string | null;
}

const SEPARATORS = /[;\t|]|\s{2,}|,(?=\s*[A-Za-zÀ-ÿ0-9])/;
const HEADER = /^(nome|jogador|player|posi[çc][ãa]o|position|overall|ovr|nota|time|clube|#)$/i;

/// Aceita desde uma lista de nomes soltos até linhas com separador, porque
/// colar de site, planilha e print de jogo produz formatos bem diferentes.
export function parsePlayerLines(raw: string): ParsedPlayerLine[] {
  const seen = new Set<string>();

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line
        .split(SEPARATORS)
        .map((part) => part.trim())
        .filter((part) => part.length > 0 && !HEADER.test(part));
      if (parts.length === 0) return null;

      // Número da camisa vem ora colado no nome, ora como coluna própria.
      if (parts.length > 1 && /^\d{1,3}$/.test(parts[0])) parts.shift();

      const name = stripLeadingNumber(parts[0]);
      if (name.length < 2 || /^\d+$/.test(name)) return null;

      const rest = parts.slice(1);
      const overallPart = rest.find((part) => /^\d{1,2}$/.test(part));
      const positionPart = rest.find((part) => part !== overallPart && part.length <= 14 && !/\d{3}/.test(part));
      const teamPart = rest.find((part) => part !== overallPart && part !== positionPart);

      return {
        name,
        position: normalizePosition(positionPart ?? null),
        overall: overallPart ? Number(overallPart) : null,
        realTeam: teamPart ?? null,
      };
    })
    .filter((player): player is ParsedPlayerLine => {
      if (!player) return false;
      const key = player.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function parseTeamLines(raw: string): Array<{ name: string; shortName: string | null }> {
  const seen = new Set<string>();

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line
        .split(SEPARATORS)
        .map((part) => part.trim())
        .filter(Boolean);
      const name = stripLeadingNumber(parts[0] ?? '');
      const shortName = parts[1] && parts[1].length <= 8 ? parts[1].toUpperCase() : null;
      return { name, shortName };
    })
    .filter((team) => {
      if (team.name.length < 2 || HEADER.test(team.name) || /^\d+$/.test(team.name)) return false;
      const key = team.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function stripLeadingNumber(value: string): string {
  return value.replace(/^\s*\d{1,3}\s*[.)-]?\s*/, '').trim();
}
