-- CreateEnum
CREATE TYPE "DraftBudgetTxType" AS ENUM ('SEED', 'MATCH_REWARD', 'SALARY', 'SIGNING', 'SALE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUST');

-- O dinheiro da liga de draft passa a ser da liga, não da conta do usuário.
ALTER TABLE "DraftLeague"
  ADD COLUMN "startingBudget" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "paySalaries" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "DraftRoster"
  ADD COLUMN "budget" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "earned" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "spent" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "DraftPlayer" ADD COLUMN "salary" INTEGER NOT NULL DEFAULT 0;

-- Salário nasce de 10% do preço para quem já está no pool.
UPDATE "DraftPlayer" SET "salary" = GREATEST(1, ROUND("price" / 10.0)) WHERE "salary" = 0;

-- Liga que já está rodando começa com o caixa cheio, senão ninguém contrata.
UPDATE "DraftRoster" SET "budget" = 1000 WHERE "budget" = 0;

-- CreateTable
CREATE TABLE "DraftBudgetEntry" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" "DraftBudgetTxType" NOT NULL,
    "description" TEXT NOT NULL,
    "round" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftBudgetEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DraftBudgetEntry_rosterId_createdAt_idx" ON "DraftBudgetEntry"("rosterId", "createdAt");
CREATE INDEX "DraftBudgetEntry_leagueId_createdAt_idx" ON "DraftBudgetEntry"("leagueId", "createdAt");

ALTER TABLE "DraftBudgetEntry"
  ADD CONSTRAINT "DraftBudgetEntry_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "DraftLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DraftBudgetEntry_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "DraftRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
