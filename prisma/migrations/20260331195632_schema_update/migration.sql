/*
  Warnings:

  - The `position` column on the `UserTeamLeague` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[userId,matchId]` on the table `UserTeamLeague` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "Position" AS ENUM ('TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('WAITING', 'STARTED', 'FINISHED', 'EXPIRED');

-- DropForeignKey
ALTER TABLE "UserTeamLeague" DROP CONSTRAINT "UserTeamLeague_teamLeagueId_fkey";

-- DropIndex
DROP INDEX "UserTeamLeague_position_idx";

-- AlterTable
ALTER TABLE "CustomLeagueMatch" ADD COLUMN     "creatorDiscordId" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "showDetails" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "status" "MatchStatus" NOT NULL DEFAULT 'FINISHED',
ALTER COLUMN "teamBlueId" DROP NOT NULL,
ALTER COLUMN "teamRedId" DROP NOT NULL,
ALTER COLUMN "riotMatchId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "UserTeamLeague" ADD COLUMN     "matchId" INTEGER,
ALTER COLUMN "teamLeagueId" DROP NOT NULL,
DROP COLUMN "position",
ADD COLUMN     "position" "Position";

-- CreateIndex
CREATE INDEX "CustomLeagueMatch_status_idx" ON "CustomLeagueMatch"("status");

-- CreateIndex
CREATE INDEX "CustomLeagueMatch_creatorDiscordId_idx" ON "CustomLeagueMatch"("creatorDiscordId");

-- CreateIndex
CREATE INDEX "UserTeamLeague_matchId_idx" ON "UserTeamLeague"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTeamLeague_userId_matchId_key" ON "UserTeamLeague"("userId", "matchId");

-- AddForeignKey
ALTER TABLE "UserTeamLeague" ADD CONSTRAINT "UserTeamLeague_teamLeagueId_fkey" FOREIGN KEY ("teamLeagueId") REFERENCES "TeamLeague"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeamLeague" ADD CONSTRAINT "UserTeamLeague_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "CustomLeagueMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
