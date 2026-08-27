-- AlterEnum: confronto direto entre dois times, decidido em melhor de N jogos
ALTER TYPE "TournamentFormat" ADD VALUE IF NOT EXISTS 'SERIES';

-- AlterEnum: a fase que agrupa os jogos dessa serie
ALTER TYPE "TournamentPhase" ADD VALUE IF NOT EXISTS 'SERIES';

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN "bestOf" INTEGER NOT NULL DEFAULT 3;
