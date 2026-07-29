-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('CLASSIC', 'ARAM');

-- AlterTable
-- Partidas antigas viram CLASSIC (Summoner's Rift), que era o único mapa
-- suportado antes deste campo existir.
ALTER TABLE "CustomLeagueMatch" ADD COLUMN "gameMode" "GameMode" NOT NULL DEFAULT 'CLASSIC';

-- CreateIndex
CREATE INDEX "CustomLeagueMatch_gameMode_idx" ON "CustomLeagueMatch"("gameMode");

-- CreateIndex
CREATE INDEX "CustomLeagueMatch_ServerDiscordId_gameMode_idx" ON "CustomLeagueMatch"("ServerDiscordId", "gameMode");
