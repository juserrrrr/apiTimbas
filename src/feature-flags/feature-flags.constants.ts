export const FEATURE_SCREEN_SHARE = 'screen_share';
export const FEATURE_LIVE_SFU = 'live_sfu';
export const FEATURE_TOURNAMENT_EA_RESULTS = 'tournament_ea_results';
export const FEATURE_TOURNAMENT_EA_AUTO_SYNC = 'tournament_ea_auto_sync';
export const FEATURE_TOURNAMENT_AI_RESULTS = 'tournament_ai_results';
export const FEATURE_LIVE_LIMIT_720P_30FPS = 'live_limit_720p_30fps';
export const FEATURE_DASHBOARD_HOME = 'dashboard_home';
export const FEATURE_DASHBOARD_TOURNAMENTS = 'dashboard_tournaments';
export const FEATURE_DASHBOARD_DRAFT = 'dashboard_draft';
export const FEATURE_DASHBOARD_MATCHES_LIVE = 'dashboard_matches_live';
export const FEATURE_DASHBOARD_MATCHES_RANKING = 'dashboard_matches_ranking';
export const FEATURE_DASHBOARD_MATCHES_HISTORY = 'dashboard_matches_history';
export const FEATURE_DASHBOARD_MATCHES_TEAMS = 'dashboard_matches_teams';
export const FEATURE_DASHBOARD_MATCHES_STATS = 'dashboard_matches_stats';
export const FEATURE_DASHBOARD_MATCHES_VERSUS = 'dashboard_matches_versus';
export const FEATURE_DASHBOARD_EA = 'dashboard_ea_clubs';
export const FEATURE_DASHBOARD_CLASH = 'dashboard_clash';
export const FEATURE_DASHBOARD_LOL_VERIFY = 'dashboard_lol_verify';
export const FEATURE_DASHBOARD_LOL_PROFILE = 'dashboard_lol_profile';
export const FEATURE_DASHBOARD_SETTINGS = 'dashboard_settings';

// Flags known by the app. Rows missing in the database are treated as disabled.
export const KNOWN_FEATURE_FLAGS: { key: string; description: string }[] = [
  { key: FEATURE_DASHBOARD_HOME, description: 'Dashboard · Início' },
  { key: FEATURE_DASHBOARD_TOURNAMENTS, description: 'Dashboard · Campeonatos' },
  { key: FEATURE_DASHBOARD_DRAFT, description: 'Dashboard · Liga Draft' },
  { key: FEATURE_DASHBOARD_MATCHES_LIVE, description: 'Dashboard · Partidas ao vivo' },
  { key: FEATURE_DASHBOARD_MATCHES_RANKING, description: 'Dashboard · Ranking' },
  { key: FEATURE_DASHBOARD_MATCHES_HISTORY, description: 'Dashboard · Histórico' },
  { key: FEATURE_DASHBOARD_MATCHES_TEAMS, description: 'Dashboard · Duplas' },
  { key: FEATURE_DASHBOARD_MATCHES_STATS, description: 'Dashboard · Estatísticas' },
  { key: FEATURE_DASHBOARD_MATCHES_VERSUS, description: 'Dashboard · Comparação' },
  { key: FEATURE_DASHBOARD_EA, description: 'Dashboard · EA FC Clubs' },
  { key: FEATURE_DASHBOARD_CLASH, description: 'Dashboard · Clash Scout' },
  { key: FEATURE_DASHBOARD_LOL_VERIFY, description: 'Dashboard · Verificar LoL' },
  { key: FEATURE_DASHBOARD_LOL_PROFILE, description: 'Dashboard · Perfil LoL' },
  { key: FEATURE_DASHBOARD_SETTINGS, description: 'Dashboard · Configurações' },
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
    key: FEATURE_TOURNAMENT_EA_AUTO_SYNC,
    description: 'Buscar automaticamente na EA as partidas dos campeonatos',
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
