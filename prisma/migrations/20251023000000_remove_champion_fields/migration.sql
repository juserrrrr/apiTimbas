-- AlterTable
ALTER TABLE "UserTeamLeague" DROP COLUMN "champion",
DROP COLUMN "rerolledChampion";

-- DropIndex
DROP INDEX "UserTeamLeague_champion_idx";
