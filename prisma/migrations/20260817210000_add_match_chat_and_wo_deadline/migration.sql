-- Confirmação do adversário e prazo para W.O.
ALTER TABLE "Tournament"
  ADD COLUMN "requireOpponentConfirm" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "woAfterHours" INTEGER NOT NULL DEFAULT 72;

ALTER TABLE "TournamentMatch"
  ADD COLUMN "readyAt" TIMESTAMP(3),
  ADD COLUMN "scheduleProposedAt" TIMESTAMP(3),
  ADD COLUMN "scheduleProposedByTeamId" TEXT,
  ADD COLUMN "claimedHomeScore" INTEGER,
  ADD COLUMN "claimedAwayScore" INTEGER,
  ADD COLUMN "claimedByTeamId" TEXT,
  ADD COLUMN "claimedAt" TIMESTAMP(3);

-- Partida que já está liberada começa a contar o prazo de agora.
UPDATE "TournamentMatch" SET "readyAt" = CURRENT_TIMESTAMP WHERE "status" = 'READY';

-- CreateTable
CREATE TABLE "TournamentMatchMessage" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" INTEGER,
    "teamId" TEXT,
    "body" TEXT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentMatchMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TournamentMatchMessage_matchId_createdAt_idx" ON "TournamentMatchMessage"("matchId", "createdAt");

ALTER TABLE "TournamentMatchMessage"
  ADD CONSTRAINT "TournamentMatchMessage_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "TournamentMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TournamentMatchMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
