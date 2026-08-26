ALTER TABLE "TournamentEaAutomationSettings"
ALTER COLUMN "checkIntervalSeconds" SET DEFAULT 30;

UPDATE "TournamentEaAutomationSettings"
SET "checkIntervalSeconds" = 30
WHERE "checkIntervalSeconds" = 120;
