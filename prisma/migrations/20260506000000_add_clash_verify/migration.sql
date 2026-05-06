-- CreateTable
CREATE TABLE "VerifiedAccount" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "riotId" TEXT NOT NULL,
    "summonerId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iconId" INTEGER NOT NULL,

    CONSTRAINT "VerifiedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingVerification" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "summonerId" TEXT NOT NULL,
    "riotId" TEXT NOT NULL,
    "targetIconId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedAccount_discordId_key" ON "VerifiedAccount"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedAccount_puuid_key" ON "VerifiedAccount"("puuid");

-- CreateIndex
CREATE INDEX "PendingVerification_discordId_idx" ON "PendingVerification"("discordId");
