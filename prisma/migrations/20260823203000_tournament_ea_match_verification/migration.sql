ALTER TABLE "TournamentTeam" ADD COLUMN "eaPlatform" TEXT;
WITH duplicates AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "tournamentId", "eaClubId"
    ORDER BY "createdAt", "id"
  ) AS row_number
  FROM "TournamentTeam"
  WHERE "eaClubId" IS NOT NULL
)
UPDATE "TournamentTeam" AS team
SET "eaClubId" = NULL, "eaPlatform" = NULL
FROM duplicates
WHERE team."id" = duplicates."id" AND duplicates.row_number > 1;
CREATE UNIQUE INDEX "TournamentTeam_tournamentId_eaClubId_key" ON "TournamentTeam"("tournamentId", "eaClubId");

ALTER TABLE "TournamentMatch"
ADD COLUMN "eaMatchId" TEXT,
ADD COLUMN "eaVerifiedAt" TIMESTAMP(3),
ADD COLUMN "eaRaw" JSONB,
ADD COLUMN "eaTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE UNIQUE INDEX "TournamentMatch_eaMatchId_key" ON "TournamentMatch"("eaMatchId");

CREATE TABLE "TournamentEaPlayerStat" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "externalPlayerId" TEXT,
  "playerName" TEXT NOT NULL,
  "position" TEXT,
  "rating" DOUBLE PRECISION,
  "goals" INTEGER NOT NULL DEFAULT 0,
  "assists" INTEGER NOT NULL DEFAULT 0,
  "shots" INTEGER,
  "passesAttempted" INTEGER,
  "passesCompleted" INTEGER,
  "tacklesAttempted" INTEGER,
  "tacklesCompleted" INTEGER,
  "saves" INTEGER,
  "manOfTheMatch" BOOLEAN,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "TournamentEaPlayerStat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TournamentEaPlayerStat_matchId_idx" ON "TournamentEaPlayerStat"("matchId");
CREATE INDEX "TournamentEaPlayerStat_teamId_idx" ON "TournamentEaPlayerStat"("teamId");
CREATE INDEX "TournamentEaPlayerStat_externalPlayerId_idx" ON "TournamentEaPlayerStat"("externalPlayerId");
ALTER TABLE "TournamentEaPlayerStat" ADD CONSTRAINT "TournamentEaPlayerStat_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "TournamentMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentEaPlayerStat" ADD CONSTRAINT "TournamentEaPlayerStat_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "TournamentTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
