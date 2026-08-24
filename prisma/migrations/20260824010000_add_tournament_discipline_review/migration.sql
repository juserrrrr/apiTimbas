ALTER TABLE "TournamentEaPlayerStat"
ADD COLUMN "yellowCards" INTEGER,
ADD COLUMN "redCards" INTEGER;

ALTER TABLE "TournamentMatch"
ADD COLUMN "reviewRequestedAt" TIMESTAMP(3),
ADD COLUMN "reviewRequestedById" INTEGER,
ADD COLUMN "reviewReason" TEXT;
