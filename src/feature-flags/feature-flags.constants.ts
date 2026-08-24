export const FEATURE_SCREEN_SHARE = 'screen_share';
export const FEATURE_LIVE_SFU = 'live_sfu';
export const FEATURE_TOURNAMENT_EA_RESULTS = 'tournament_ea_results';
export const FEATURE_TOURNAMENT_AI_RESULTS = 'tournament_ai_results';
export const FEATURE_LIVE_LIMIT_720P_30FPS = 'live_limit_720p_30fps';

// Flags known by the app. Rows missing in the database are treated as disabled.
export const KNOWN_FEATURE_FLAGS: { key: string; description: string }[] = [
  {
    key: FEATURE_SCREEN_SHARE,
    description: 'Transmissão de tela ao vivo no dashboard',
  },
  {
    key: FEATURE_LIVE_SFU,
    description: 'Servidor de transmissão (SFU) para as lives',
  },
  {
    key: FEATURE_TOURNAMENT_EA_RESULTS,
    description: 'Sincronizar resultados de campeonatos pela API da EA',
  },
  {
    key: FEATURE_TOURNAMENT_AI_RESULTS,
    description: 'Analisar provas de resultados de campeonatos com IA',
  },
  {
    key: FEATURE_LIVE_LIMIT_720P_30FPS,
    description: 'Limitar transmissões a 720p e 30 FPS',
  },
];
