-- CreateEnum
CREATE TYPE "BetStatus" AS ENUM ('PENDING', 'WON', 'LOST', 'REFUNDED');

-- AlterTable
ALTER TABLE "CustomLeagueMatch" ADD COLUMN "mvpUserId" INTEGER;

-- CreateTable
CREATE TABLE "Season" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "champions" JSONB,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsWallet" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointsWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bet" (
    "id" SERIAL NOT NULL,
    "matchId" INTEGER NOT NULL,
    "serverId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "BetStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Season_serverId_endedAt_idx" ON "Season"("serverId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Season_serverId_number_key" ON "Season"("serverId", "number");

-- CreateIndex
CREATE INDEX "Achievement_serverId_userId_idx" ON "Achievement"("serverId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_serverId_userId_type_key" ON "Achievement"("serverId", "userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "PointsWallet_serverId_discordId_key" ON "PointsWallet"("serverId", "discordId");

-- CreateIndex
CREATE INDEX "Bet_matchId_status_idx" ON "Bet"("matchId", "status");

-- CreateIndex
CREATE INDEX "Bet_serverId_discordId_idx" ON "Bet"("serverId", "discordId");

-- CreateIndex
CREATE UNIQUE INDEX "Bet_matchId_discordId_key" ON "Bet"("matchId", "discordId");
