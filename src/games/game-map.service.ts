import { Injectable, NotFoundException } from '@nestjs/common';
import { LOCAL_GAME_MAPS, PRIMARY_MAP_ID } from './deducao/maps';
import type { GameMap } from './deducao/map';

export interface GameMapSummary {
  id: string;
  name: string;
  original: boolean;
  updatedAt: null;
}

export interface GameMapEntry extends GameMapSummary {
  map: GameMap;
}

/// Catálogo somente de leitura dos mapas versionados junto do jogo. Um mapa novo
/// entra em `deducao/maps.ts`; nenhuma configuração de produção reescreve a fase.
@Injectable()
export class GameMapService {
  async list(): Promise<GameMapSummary[]> {
    return LOCAL_GAME_MAPS.map(({ id, map }) => ({
      id,
      name: map.name,
      original: id === PRIMARY_MAP_ID,
      updatedAt: null,
    }));
  }

  async get(id = PRIMARY_MAP_ID): Promise<GameMapEntry> {
    const requestedId = id?.trim() || PRIMARY_MAP_ID;
    const entry = LOCAL_GAME_MAPS.find(
      (candidate) => candidate.id === requestedId,
    );
    if (!entry) throw new NotFoundException('Esse mapa não existe mais.');

    return {
      id: entry.id,
      name: entry.map.name,
      original: entry.id === PRIMARY_MAP_ID,
      updatedAt: null,
      map: entry.map,
    };
  }

  async current(): Promise<GameMap> {
    return (await this.get()).map;
  }
}
