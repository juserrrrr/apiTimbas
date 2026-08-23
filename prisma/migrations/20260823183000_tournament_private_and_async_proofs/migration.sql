CREATE TYPE "TournamentAccessMode" AS ENUM ('PUBLIC', 'INVITE_ONLY');

ALTER TABLE "Tournament"
ADD COLUMN "accessMode" "TournamentAccessMode" NOT NULL DEFAULT 'PUBLIC',
ADD COLUMN "inviteCode" TEXT;

ALTER TABLE "Tournament" ALTER COLUMN "autoApproveMinConfidence" SET DEFAULT 90;
UPDATE "Tournament" SET "autoApproveMinConfidence" = 90 WHERE "autoApproveMinConfidence" < 90;

CREATE UNIQUE INDEX "Tournament_inviteCode_key" ON "Tournament"("inviteCode");

CREATE TABLE "TournamentInvite" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "invitedById" INTEGER,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TournamentInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TournamentInvite_tournamentId_userId_key" ON "TournamentInvite"("tournamentId", "userId");
CREATE INDEX "TournamentInvite_userId_idx" ON "TournamentInvite"("userId");
ALTER TABLE "TournamentInvite" ADD CONSTRAINT "TournamentInvite_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentInvite" ADD CONSTRAINT "TournamentInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentInvite" ADD CONSTRAINT "TournamentInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MatchProof"
ADD COLUMN "imageSha256" TEXT,
ADD COLUMN "processingAt" TIMESTAMP(3),
ADD COLUMN "processedAt" TIMESTAMP(3),
ADD COLUMN "processingAttempts" INTEGER NOT NULL DEFAULT 0;

UPDATE "MatchProof" SET "imageSha256" = md5("id") WHERE "imageSha256" IS NULL;
ALTER TABLE "MatchProof" ALTER COLUMN "imageSha256" SET NOT NULL;
CREATE UNIQUE INDEX "MatchProof_imageSha256_key" ON "MatchProof"("imageSha256");
CREATE UNIQUE INDEX "MatchProof_one_pending_per_match" ON "MatchProof"("matchId") WHERE "status" = 'PENDING' AND "matchId" IS NOT NULL;
