INSERT INTO "FeatureFlag" ("key", "enabled", "description", "updatedAt")
VALUES
  ('tournament_ea_results', true, 'Sincronizar resultados de campeonatos pela API da EA', CURRENT_TIMESTAMP),
  ('tournament_ai_results', false, 'Analisar provas de resultados de campeonatos com IA', CURRENT_TIMESTAMP),
  ('live_limit_720p_30fps', false, 'Limitar transmissões a 720p e 30 FPS', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
