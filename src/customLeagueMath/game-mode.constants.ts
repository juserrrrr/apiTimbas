import { GameMode } from '@prisma/client';

/**
 * Fonte única de verdade sobre modos de jogo das partidas personalizadas.
 *
 * Guardamos apenas o modo no banco: o mapa é consequência dele
 * (CLASSIC roda no Summoner's Rift, ARAM no Howling Abyss). Ter as duas
 * colunas permitiria gravar combinações que não existem no jogo.
 */

/** Nome do modo como aparece para o usuário. */
export const GAME_MODE_LABELS: Record<GameMode, string> = {
  CLASSIC: 'Clássico',
  ARAM: 'ARAM',
};

/** Mapa onde o modo é jogado. Derivado, nunca persistido. */
export const GAME_MODE_MAP_NAMES: Record<GameMode, string> = {
  CLASSIC: "Summoner's Rift",
  ARAM: 'Howling Abyss',
};

export const GAME_MODE_EMOJIS: Record<GameMode, string> = {
  CLASSIC: '🗺️',
  ARAM: '❄️',
};

/** Cabeçalho do embed do Discord: "[Clássico] - Summoner's Rift". */
export function gameModeHeader(gameMode: GameMode = GameMode.CLASSIC): string {
  const mode = GAME_MODE_LABELS[gameMode] ?? GAME_MODE_LABELS.CLASSIC;
  const map = GAME_MODE_MAP_NAMES[gameMode] ?? GAME_MODE_MAP_NAMES.CLASSIC;
  return `[${mode}] - ${map}`;
}

/**
 * ARAM é uma lane só, então não faz sentido sortear TOP/JUNGLE/MID/ADC/SUP.
 * Usado para bloquear o formato ALEATORIO_COMPLETO fora do Clássico.
 */
export function supportsLanes(gameMode: GameMode): boolean {
  return gameMode === GameMode.CLASSIC;
}

/** Converte entrada externa em GameMode, caindo no padrão quando inválida. */
export function parseGameMode(value: unknown): GameMode {
  return value === GameMode.ARAM ? GameMode.ARAM : GameMode.CLASSIC;
}
