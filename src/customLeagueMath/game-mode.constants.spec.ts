import { GameMode } from '@prisma/client';
import {
  GAME_MODE_LABELS,
  GAME_MODE_MAP_NAMES,
  gameModeHeader,
  supportsLanes,
  parseGameMode,
} from './game-mode.constants';

describe('game-mode.constants', () => {
  it('deve ter label e mapa para todo valor do enum GameMode', () => {
    // Se alguém adicionar um modo novo no schema sem atualizar as tabelas,
    // esse teste quebra antes de a UI mostrar "undefined".
    for (const mode of Object.values(GameMode)) {
      expect(GAME_MODE_LABELS[mode]).toBeTruthy();
      expect(GAME_MODE_MAP_NAMES[mode]).toBeTruthy();
    }
  });

  describe('gameModeHeader', () => {
    it('deve montar o cabeçalho da Fenda atual', () => {
      expect(gameModeHeader(GameMode.SUMMONERS_RIFT)).toBe("[League of Legends] - Summoner's Rift");
    });

    it('deve montar o cabeçalho do League Classic', () => {
      expect(gameModeHeader(GameMode.LOL_CLASSIC)).toBe("[League Classic] - Summoner's Rift");
    });

    it('deve montar o cabeçalho do ARAM com o Howling Abyss', () => {
      expect(gameModeHeader(GameMode.ARAM)).toBe('[ARAM] - Howling Abyss');
    });

    it('deve usar a Fenda atual como padrão quando nenhum modo é passado', () => {
      expect(gameModeHeader()).toBe("[League of Legends] - Summoner's Rift");
    });

    it('deve dar um cabeçalho diferente para cada modo', () => {
      // League Classic e Normal rodam no mesmo mapa; se os cabeçalhos
      // colidirem, ninguém distingue os dois no embed do Discord.
      const headers = Object.values(GameMode).map((m) => gameModeHeader(m));
      expect(new Set(headers).size).toBe(headers.length);
    });

    it('deve caber na largura de 39 colunas do embed do Discord', () => {
      // O embed corta em 39 caracteres; um nome maior sairia truncado na tela.
      for (const mode of Object.values(GameMode)) {
        expect(gameModeHeader(mode).length).toBeLessThanOrEqual(39);
      }
    });
  });

  describe('supportsLanes', () => {
    it('deve permitir lanes na Fenda atual', () => {
      expect(supportsLanes(GameMode.SUMMONERS_RIFT)).toBe(true);
    });

    it('deve permitir lanes no League Classic, que é 5v5 com as rotas normais', () => {
      expect(supportsLanes(GameMode.LOL_CLASSIC)).toBe(true);
    });

    it('não deve permitir lanes no ARAM, que tem rota única', () => {
      expect(supportsLanes(GameMode.ARAM)).toBe(false);
    });
  });

  describe('parseGameMode', () => {
    it('deve reconhecer todo valor válido do enum', () => {
      for (const mode of Object.values(GameMode)) {
        expect(parseGameMode(mode)).toBe(mode);
      }
    });

    it('deve cair na Fenda atual para entradas inválidas ou ausentes', () => {
      expect(parseGameMode('URF')).toBe(GameMode.SUMMONERS_RIFT);
      expect(parseGameMode('CLASSIC')).toBe(GameMode.SUMMONERS_RIFT);
      expect(parseGameMode(undefined)).toBe(GameMode.SUMMONERS_RIFT);
      expect(parseGameMode(null)).toBe(GameMode.SUMMONERS_RIFT);
      expect(parseGameMode(42)).toBe(GameMode.SUMMONERS_RIFT);
    });
  });
});
