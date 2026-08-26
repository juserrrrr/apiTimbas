ALTER TABLE "TournamentMatch"
ADD COLUMN "eaLastCheckedAt" TIMESTAMP(3),
ADD COLUMN "eaNextCheckAt" TIMESTAMP(3),
ADD COLUMN "eaCheckMessage" TEXT;

CREATE INDEX "TournamentMatch_eaNextCheckAt_idx" ON "TournamentMatch"("eaNextCheckAt");
