-- AlterTable
ALTER TABLE "CustomLeagueMatch" ADD COLUMN "playersPerTeam" INTEGER NOT NULL DEFAULT 5;

-- CreateIndex
CREATE INDEX "CustomLeagueMatch_playersPerTeam_idx" ON "CustomLeagueMatch"("playersPerTeam");
