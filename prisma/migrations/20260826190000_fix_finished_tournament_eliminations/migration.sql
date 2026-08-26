-- Normaliza campeonatos jÃ¡ encerrados: somente o campeÃ£o deve permanecer
-- como nÃ£o eliminado. Corrige inclusive avanÃ§os por bye/W.O. e colocaÃ§Ãµes.
UPDATE "TournamentTeam" AS team
SET "eliminated" = (team."id" <> tournament."championTeamId")
FROM "Tournament" AS tournament
WHERE tournament."id" = team."tournamentId"
  AND tournament."status" = 'FINISHED'
  AND tournament."championTeamId" IS NOT NULL;
