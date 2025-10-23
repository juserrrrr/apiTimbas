-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('ALEATORIO', 'LIVRE', 'BALANCEADO', 'ALEATORIO_COMPLETO');

-- AlterTable "UserTeamLeague" - Add new fields
ALTER TABLE "UserTeamLeague" ADD COLUMN "position" VARCHAR(20),
                              ADD COLUMN "champion" VARCHAR(50),
                              ADD COLUMN "rerolledChampion" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable "CustomLeagueMatch" - Add matchType field
ALTER TABLE "CustomLeagueMatch" ADD COLUMN "matchType" "MatchType" NOT NULL DEFAULT 'ALEATORIO';

-- CreateIndex
CREATE INDEX "UserTeamLeague_champion_idx" ON "UserTeamLeague"("champion");

-- CreateIndex
CREATE INDEX "UserTeamLeague_position_idx" ON "UserTeamLeague"("position");

-- CreateIndex
CREATE INDEX "CustomLeagueMatch_matchType_idx" ON "CustomLeagueMatch"("matchType");
