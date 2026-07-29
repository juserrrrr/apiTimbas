import { GameMode } from '@prisma/client';

/**
 * Fonte única de verdade sobre modos de jogo das partidas personalizadas.
 *
 * Guardamos apenas o modo no banco: o mapa é consequência dele. Ter as duas
 * colunas permitiria gravar combinações que não existem no jogo.
 *
 * SUMMONERS_RIFT e LOL_CLASSIC rodam na mesma Fenda, em versões diferentes
 * (atual x Season 3), o que reforça o modo como eixo certo em vez do mapa.
 */

/** Nome do modo como aparece para o usuário. */
export const GAME_MODE_LABELS: Record<GameMode, string> = {
  SUMMONERS_RIFT: 'Normal',
  LOL_CLASSIC: 'League Classic',
  ARAM: 'ARAM',
};

/** Mapa onde o modo é jogado. Derivado, nunca persistido. */
export const GAME_MODE_MAP_NAMES: Record<GameMode, string> = {
  SUMMONERS_RIFT: "Summoner's Rift",
  LOL_CLASSIC: "Summoner's Rift (2013)",
  ARAM: 'Howling Abyss',
};

export const GAME_MODE_EMOJIS: Record<GameMode, string> = {
  SUMMONERS_RIFT: '🗺️',
  LOL_CLASSIC: '📜',
  ARAM: '❄️',
};

/**
 * Cabeçalho do embed do Discord. Tabela própria em vez de compor
 * `[label] - mapa` porque o embed corta em 39 colunas e
 * "[League Classic] - Summoner's Rift (2013)" estoura esse limite.
 */
const GAME_MODE_HEADERS: Record<GameMode, string> = {
  SUMMONERS_RIFT: "[League of Legends] - Summoner's Rift",
  LOL_CLASSIC: "[League Classic] - Summoner's Rift",
  ARAM: '[ARAM] - Howling Abyss',
};

export function gameModeHeader(gameMode: GameMode = GameMode.SUMMONERS_RIFT): string {
  return GAME_MODE_HEADERS[gameMode] ?? GAME_MODE_HEADERS.SUMMONERS_RIFT;
}

/**
 * ARAM é uma lane só, então não faz sentido sortear TOP/JUNGLE/MID/ADC/SUP.
 * League Classic é 5v5 com as rotas normais (meta da Season 3), então aceita.
 * Usado para bloquear o formato ALEATORIO_COMPLETO fora dos mapas com rotas.
 */
export function supportsLanes(gameMode: GameMode): boolean {
  return gameMode !== GameMode.ARAM;
}

/** Converte entrada externa em GameMode, caindo no padrão quando inválida. */
export function parseGameMode(value: unknown): GameMode {
  return Object.values(GameMode).includes(value as GameMode)
    ? (value as GameMode)
    : GameMode.SUMMONERS_RIFT;
}
