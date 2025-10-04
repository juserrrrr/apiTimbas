/*
  Warnings:

  - You are about to drop the column `leaguePuuid` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[riotMatchId]` on the table `CustomLeagueMatch` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `riotMatchId` to the `CustomLeagueMatch` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "User_leaguePuuid_idx";

-- DropIndex
DROP INDEX "User_leaguePuuid_key";

-- AlterTable
ALTER TABLE "CustomLeagueMatch" ADD COLUMN     "riotMatchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "leaguePuuid";

-- CreateTable
CREATE TABLE "LeagueAccount" (
    "id" SERIAL NOT NULL,
    "puuid" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeagueAccount_puuid_key" ON "LeagueAccount"("puuid");

-- CreateIndex
CREATE INDEX "LeagueAccount_userId_idx" ON "LeagueAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomLeagueMatch_riotMatchId_key" ON "CustomLeagueMatch"("riotMatchId");

-- AddForeignKey
ALTER TABLE "LeagueAccount" ADD CONSTRAINT "LeagueAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
