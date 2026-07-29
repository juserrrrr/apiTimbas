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
    it('deve montar o cabeçalho do Clássico com o Summoner\'s Rift', () => {
      expect(gameModeHeader(GameMode.CLASSIC)).toBe("[Clássico] - Summoner's Rift");
    });

    it('deve montar o cabeçalho do ARAM com o Howling Abyss', () => {
      expect(gameModeHeader(GameMode.ARAM)).toBe('[ARAM] - Howling Abyss');
    });

    it('deve usar o Clássico como padrão quando nenhum modo é passado', () => {
      expect(gameModeHeader()).toBe("[Clássico] - Summoner's Rift");
    });

    it('deve caber na largura de 39 colunas do embed do Discord', () => {
      // O embed corta em 39 caracteres; um nome maior sairia truncado na tela.
      for (const mode of Object.values(GameMode)) {
        expect(gameModeHeader(mode).length).toBeLessThanOrEqual(39);
      }
    });
  });

  describe('supportsLanes', () => {
    it('deve permitir lanes no Clássico', () => {
      expect(supportsLanes(GameMode.CLASSIC)).toBe(true);
    });

    it('não deve permitir lanes no ARAM, que tem rota única', () => {
      expect(supportsLanes(GameMode.ARAM)).toBe(false);
    });
  });

  describe('parseGameMode', () => {
    it('deve reconhecer ARAM', () => {
      expect(parseGameMode('ARAM')).toBe(GameMode.ARAM);
    });

    it('deve cair no Clássico para entradas inválidas ou ausentes', () => {
      expect(parseGameMode('URF')).toBe(GameMode.CLASSIC);
      expect(parseGameMode(undefined)).toBe(GameMode.CLASSIC);
      expect(parseGameMode(null)).toBe(GameMode.CLASSIC);
      expect(parseGameMode(42)).toBe(GameMode.CLASSIC);
    });
  });
});
