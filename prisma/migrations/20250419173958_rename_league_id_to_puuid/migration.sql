/*
  Warnings:

  - You are about to drop the column `leagueId` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[leaguePuuid]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "User_leagueId_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "leagueId",
ADD COLUMN     "leaguePuuid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_leaguePuuid_key" ON "User"("leaguePuuid");
