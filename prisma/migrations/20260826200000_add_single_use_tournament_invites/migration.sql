CREATE TABLE "TournamentRegistrationInvite" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdById" INTEGER,
    "claimedById" INTEGER,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TournamentRegistrationInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TournamentRegistrationInvite_code_key" ON "TournamentRegistrationInvite"("code");
CREATE INDEX "TournamentRegistrationInvite_tournamentId_usedAt_idx" ON "TournamentRegistrationInvite"("tournamentId", "usedAt");

ALTER TABLE "TournamentRegistrationInvite" ADD CONSTRAINT "TournamentRegistrationInvite_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentRegistrationInvite" ADD CONSTRAINT "TournamentRegistrationInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TournamentRegistrationInvite" ADD CONSTRAINT "TournamentRegistrationInvite_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
