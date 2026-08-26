ALTER TABLE "PlatformSettings"
ADD COLUMN "defaultPermissions" TEXT[] NOT NULL DEFAULT ARRAY[
  'dashboard.home',
  'dashboard.tournaments',
  'dashboard.draft',
  'dashboard.live',
  'dashboard.matches.live',
  'dashboard.matches.ranking',
  'dashboard.matches.history',
  'dashboard.matches.teams',
  'dashboard.matches.stats',
  'dashboard.matches.versus',
  'dashboard.ea',
  'dashboard.clash',
  'dashboard.lol.verify',
  'dashboard.lol.profile',
  'dashboard.settings'
]::TEXT[];

INSERT INTO "FeatureFlag" ("key", "enabled", "description", "updatedAt") VALUES
  ('dashboard_home', true, 'Dashboard · Início', CURRENT_TIMESTAMP),
  ('dashboard_tournaments', true, 'Dashboard · Campeonatos', CURRENT_TIMESTAMP),
  ('dashboard_draft', true, 'Dashboard · Liga Draft', CURRENT_TIMESTAMP),
  ('dashboard_matches_live', true, 'Dashboard · Partidas ao vivo', CURRENT_TIMESTAMP),
  ('dashboard_matches_ranking', true, 'Dashboard · Ranking', CURRENT_TIMESTAMP),
  ('dashboard_matches_history', true, 'Dashboard · Histórico', CURRENT_TIMESTAMP),
  ('dashboard_matches_teams', true, 'Dashboard · Duplas', CURRENT_TIMESTAMP),
  ('dashboard_matches_stats', true, 'Dashboard · Estatísticas', CURRENT_TIMESTAMP),
  ('dashboard_matches_versus', true, 'Dashboard · Comparação', CURRENT_TIMESTAMP),
  ('dashboard_ea_clubs', true, 'Dashboard · EA FC Clubs', CURRENT_TIMESTAMP),
  ('dashboard_clash', true, 'Dashboard · Clash Scout', CURRENT_TIMESTAMP),
  ('dashboard_lol_verify', true, 'Dashboard · Verificar LoL', CURRENT_TIMESTAMP),
  ('dashboard_lol_profile', true, 'Dashboard · Perfil LoL', CURRENT_TIMESTAMP),
  ('dashboard_settings', true, 'Dashboard · Configurações', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
