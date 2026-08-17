-- CreateEnum
CREATE TYPE "DraftResultMode" AS ENUM ('REPORTED', 'SIMULATED');
CREATE TYPE "TacticMentality" AS ENUM ('DEFENSIVE', 'BALANCED', 'ATTACKING');
CREATE TYPE "TacticIntensity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- Liga: modo de resultado e janela de mercado automática
ALTER TABLE "DraftLeague"
  ADD COLUMN "resultMode" "DraftResultMode" NOT NULL DEFAULT 'REPORTED',
  ADD COLUMN "marketClosesMinutesBefore" INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN "marketAutoManaged" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "DraftLeague_status_resultMode_idx" ON "DraftLeague"("status", "resultMode");

-- Competições da base que a liga aceita
CREATE TABLE "DraftLeagueSource" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftLeagueSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DraftLeagueSource_leagueId_competitionId_key" ON "DraftLeagueSource"("leagueId", "competitionId");
CREATE INDEX "DraftLeagueSource_competitionId_idx" ON "DraftLeagueSource"("competitionId");

ALTER TABLE "DraftLeagueSource"
  ADD CONSTRAINT "DraftLeagueSource_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "DraftLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DraftLeagueSource_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "CatalogCompetition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Táticas do elenco
ALTER TABLE "DraftRoster"
  ADD COLUMN "mentality" "TacticMentality" NOT NULL DEFAULT 'BALANCED',
  ADD COLUMN "pressing" "TacticIntensity" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "tempo" "TacticIntensity" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "tacticsAt" TIMESTAMP(3);

-- Forma, idade e última nota do jogador na liga
ALTER TABLE "DraftPlayer"
  ADD COLUMN "birthDate" TIMESTAMP(3),
  ADD COLUMN "lastRating" DOUBLE PRECISION,
  ADD COLUMN "form" INTEGER NOT NULL DEFAULT 0;

-- Vida do jogador na base global
ALTER TABLE "CatalogPlayer"
  ADD COLUMN "form" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "matchesPlayed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ratingAvg" DOUBLE PRECISION,
  ADD COLUMN "lastRating" DOUBLE PRECISION,
  ADD COLUMN "lastPlayedAt" TIMESTAMP(3);

ALTER TABLE "CatalogCompetition"
  ADD COLUMN "simulationEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "worldRound" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastWorldTickAt" TIMESTAMP(3);
