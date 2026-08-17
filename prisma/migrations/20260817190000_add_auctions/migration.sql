-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('OPEN', 'SOLD', 'EXPIRED', 'CANCELLED');

ALTER TYPE "DraftBudgetTxType" ADD VALUE 'AUCTION_BID';
ALTER TYPE "DraftBudgetTxType" ADD VALUE 'AUCTION_REFUND';
ALTER TYPE "DraftBudgetTxType" ADD VALUE 'AUCTION_SALE';

-- Regras do leilão por liga
ALTER TABLE "DraftLeague"
  ADD COLUMN "auctionsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "auctionHours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN "auctionMinIncrementPercent" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "auctionAntiSnipeMinutes" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "DraftAuction" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "sellerRosterId" TEXT,
    "startingBid" INTEGER NOT NULL,
    "currentBid" INTEGER NOT NULL DEFAULT 0,
    "bidCount" INTEGER NOT NULL DEFAULT 0,
    "leaderRosterId" TEXT,
    "status" "AuctionStatus" NOT NULL DEFAULT 'OPEN',
    "endsAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftAuction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DraftAuctionBid" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftAuctionBid_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DraftAuction_leagueId_status_idx" ON "DraftAuction"("leagueId", "status");
CREATE INDEX "DraftAuction_status_endsAt_idx" ON "DraftAuction"("status", "endsAt");
CREATE INDEX "DraftAuction_playerId_idx" ON "DraftAuction"("playerId");
CREATE INDEX "DraftAuctionBid_auctionId_createdAt_idx" ON "DraftAuctionBid"("auctionId", "createdAt");
CREATE INDEX "DraftAuctionBid_rosterId_idx" ON "DraftAuctionBid"("rosterId");

ALTER TABLE "DraftAuction"
  ADD CONSTRAINT "DraftAuction_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "DraftLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DraftAuction_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "DraftPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DraftAuction_sellerRosterId_fkey" FOREIGN KEY ("sellerRosterId") REFERENCES "DraftRoster"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "DraftAuction_leaderRosterId_fkey" FOREIGN KEY ("leaderRosterId") REFERENCES "DraftRoster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DraftAuctionBid"
  ADD CONSTRAINT "DraftAuctionBid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "DraftAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DraftAuctionBid_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "DraftRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
