/*
  Warnings:

  - A unique constraint covering the columns `[leagueId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "leagueId" TEXT,
ALTER COLUMN "role" SET DEFAULT 'PLAYER';

-- CreateIndex
CREATE UNIQUE INDEX "User_leagueId_key" ON "User"("leagueId");
