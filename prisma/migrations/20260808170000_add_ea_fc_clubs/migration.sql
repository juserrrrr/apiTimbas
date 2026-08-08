CREATE TYPE "EaClubMatchResult" AS ENUM ('WIN', 'DRAW', 'LOSS');

CREATE TABLE "EaClub" (
    "id" TEXT NOT NULL,
    "externalClubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "nickname" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    CONSTRAINT "EaClub_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EaClubMatch" (
    "id" TEXT NOT NULL,
    "externalMatchId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL,
    "isHome" BOOLEAN NOT NULL,
    "opponentExternalId" TEXT NOT NULL,
    "opponentName" TEXT NOT NULL,
    "goalsFor" INTEGER NOT NULL,
    "goalsAgainst" INTEGER NOT NULL,
    "result" "EaClubMatchResult" NOT NULL,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EaClubMatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EaClubPlayer" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "externalPlayerId" TEXT,
    "identityKey" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EaClubPlayer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EaMatchPlayerStat" (
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "position" TEXT,
    "rating" DOUBLE PRECISION,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "shots" INTEGER,
    "passesAttempted" INTEGER,
    "passesCompleted" INTEGER,
    "tacklesAttempted" INTEGER,
    "tacklesCompleted" INTEGER,
    "saves" INTEGER,
    "manOfTheMatch" BOOLEAN,
    CONSTRAINT "EaMatchPlayerStat_pkey" PRIMARY KEY ("matchId", "playerId")
);

CREATE UNIQUE INDEX "EaClub_externalClubId_platform_key" ON "EaClub"("externalClubId", "platform");
CREATE INDEX "EaClub_name_idx" ON "EaClub"("name");
CREATE UNIQUE INDEX "EaClubMatch_externalMatchId_key" ON "EaClubMatch"("externalMatchId");
CREATE INDEX "EaClubMatch_clubId_playedAt_idx" ON "EaClubMatch"("clubId", "playedAt");
CREATE INDEX "EaClubMatch_clubId_result_playedAt_idx" ON "EaClubMatch"("clubId", "result", "playedAt");
CREATE INDEX "EaClubMatch_clubId_opponentName_idx" ON "EaClubMatch"("clubId", "opponentName");
CREATE UNIQUE INDEX "EaClubPlayer_clubId_identityKey_key" ON "EaClubPlayer"("clubId", "identityKey");
CREATE INDEX "EaClubPlayer_clubId_playerName_idx" ON "EaClubPlayer"("clubId", "playerName");
CREATE INDEX "EaClubPlayer_clubId_externalPlayerId_idx" ON "EaClubPlayer"("clubId", "externalPlayerId");
CREATE INDEX "EaMatchPlayerStat_playerId_matchId_idx" ON "EaMatchPlayerStat"("playerId", "matchId");
CREATE INDEX "EaMatchPlayerStat_matchId_idx" ON "EaMatchPlayerStat"("matchId");

ALTER TABLE "EaClubMatch" ADD CONSTRAINT "EaClubMatch_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "EaClub"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EaClubPlayer" ADD CONSTRAINT "EaClubPlayer_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "EaClub"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EaMatchPlayerStat" ADD CONSTRAINT "EaMatchPlayerStat_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "EaClubMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EaMatchPlayerStat" ADD CONSTRAINT "EaMatchPlayerStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "EaClubPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
