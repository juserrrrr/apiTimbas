-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('ALEATORIO', 'LIVRE', 'BALANCEADO', 'ALEATORIO_COMPLETO');

-- AlterTable
ALTER TABLE "CustomLeagueMatch" ADD COLUMN     "matchType" "MatchType" NOT NULL DEFAULT 'ALEATORIO';

-- AlterTable
ALTER TABLE "UserTeamLeague" ADD COLUMN     "position" TEXT;

-- CreateIndex
CREATE INDEX "CustomLeagueMatch_matchType_idx" ON "CustomLeagueMatch"("matchType");

-- CreateIndex
CREATE INDEX "UserTeamLeague_position_idx" ON "UserTeamLeague"("position");
