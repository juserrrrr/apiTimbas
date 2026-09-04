import { OFFICE_MAP, type GameMap } from './map';

export interface LocalGameMap {
  id: string;
  map: GameMap;
}

/// `original` continua estável para as salas e links existentes. Para adicionar
/// outro mapa, crie sua definição local e registre-a aqui com um id permanente.
export const PRIMARY_MAP_ID = 'original';

export const LOCAL_GAME_MAPS: readonly LocalGameMap[] = [
  { id: PRIMARY_MAP_ID, map: OFFICE_MAP },
];
