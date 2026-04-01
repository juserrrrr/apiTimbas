/**
 * Port of commands/utilsPerson/helpers.py → generate_league_embed_text
 */

interface TeamPlayer {
  name: string;
  position?: string;
}

function toTeamPlayer(p: any): TeamPlayer {
  if (p && typeof p === 'object' && 'user' in p) {
    return { name: (p.user?.name ?? p.user?.username ?? '?').slice(0, 12), position: p.position ?? '' };
  }
  if (p && typeof p === 'object' && 'name' in p) {
    return { name: (p.name ?? '?').slice(0, 12), position: '' };
  }
  return { name: '?', position: '' };
}

const FORMAT_ABBREV: Record<string, string> = {
  Aleatório: 'Aleatório',
  Livre: 'Livre',
  Balanceado: 'Balanceado',
  'Aleatório Completo': 'Aleat. Completo',
};

const MODE_ABBREV: Record<string, string> = {
  Online: 'Online',
  Offline: 'Offline',
};

const POS_ABBREV: Record<string, string> = {
  TOP: 'TOP', JUNGLE: 'JG', MID: 'MID', ADC: 'ADC', SUPPORT: 'SUP',
  Top: 'TOP', Jungle: 'JG', Suporte: 'SUP',
};

function pad(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (align === 'right') return s.padStart(width);
  return s.padEnd(width);
}

export function generateLeagueEmbedText(
  blueTeam: any[],
  redTeam: any[],
  matchFormat: string,
  onlineMode: string,
  winner?: 'BLUE' | 'RED' | null,
  showDetails = false,
): string {
  const half = 5;

  const formatStr = `Fmt: ${FORMAT_ABBREV[matchFormat] ?? matchFormat.slice(0, 10)}`;
  const onlineModeStr = `Modo: ${MODE_ABBREV[onlineMode] ?? onlineMode.slice(0, 8)}`;
  const mapName = "[League of Legends] - Summoner's Rift";

  let bluePad = 18;
  let redPad = 18;
  let blueHeader = 'Time Azul';
  let redHeader = 'Time Vermelho';

  if (winner === 'BLUE') {
    blueHeader = 'Time Azul 🏆';
    bluePad -= 2;
  } else if (winner === 'RED') {
    redHeader = '🏆 Time Vermelho';
    redPad -= 2;
  }

  const lines: string[] = [
    `${'   -----'.padEnd(21)}${'-*-'.padStart(3).padEnd(3)}${'-----   '.padStart(21)}`,
    `${''.padEnd(9)}${'Partida personalizada ⚔️'.padStart(13 + 14).padEnd(27)}${''.padStart(9)}`,
    `${''.padEnd(3)} ${mapName.padStart(20 + 19).slice(0, 39)} ${''.padStart(3)}`,
    `${formatStr.padEnd(22)}${''.padEnd(1)}${onlineModeStr.padStart(22)}`,
    `${blueHeader.padEnd(bluePad)}${'< EQP >'.padStart(4).padEnd(9)}${redHeader.padStart(redPad)}`,
    '',
  ];

  for (let i = 0; i < half; i++) {
    const bRaw = i < blueTeam.length ? toTeamPlayer(blueTeam[i]) : { name: 'Vazio', position: '' };
    const rRaw = i < redTeam.length ? toTeamPlayer(redTeam[i]) : { name: 'Vazio', position: '' };

    const blueName = bRaw.name.slice(0, 12);
    const redName = rRaw.name.slice(0, 12);
    const bluePos = bRaw.position ?? '';
    const redPos = rRaw.position ?? '';

    if (showDetails && (bluePos || redPos)) {
      const bShort = POS_ABBREV[bluePos] ?? bluePos.slice(0, 3).toUpperCase();
      const rShort = POS_ABBREV[redPos] ?? redPos.slice(0, 3).toUpperCase();
      const bStr = `[${bShort}] ${blueName.padEnd(12)}`;
      const rStr = `${redName.padStart(12)} [${rShort}]`;
      lines.push(`${bStr.padEnd(19)}${'< VS >'.padStart(3).padEnd(7)}${rStr.padStart(19)}`);
    } else {
      lines.push(`${blueName.padEnd(19)}${'< VS >'.padStart(3).padEnd(7)}${redName.padStart(19)}`);
    }
  }

  return lines.join('\n');
}
