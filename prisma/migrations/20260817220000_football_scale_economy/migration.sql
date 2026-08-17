-- Elenco de clube de verdade: 25 jogadores, 11 em campo e o resto no banco e na
-- reserva. E a economia sai da escala de moedinha para a escala de futebol, em
-- reais.
ALTER TABLE "DraftLeague" ALTER COLUMN "rosterSize" SET DEFAULT 25;
ALTER TABLE "DraftLeague" ALTER COLUMN "startingBudget" SET DEFAULT 200000000;
ALTER TABLE "DraftLeague" ALTER COLUMN "coinsWin" SET DEFAULT 3000000;
ALTER TABLE "DraftLeague" ALTER COLUMN "coinsDraw" SET DEFAULT 1000000;
ALTER TABLE "DraftLeague" ALTER COLUMN "coinsLoss" SET DEFAULT 400000;
ALTER TABLE "CatalogPlayer" ALTER COLUMN "price" SET DEFAULT 500000;
ALTER TABLE "DraftPlayer" ALTER COLUMN "price" SET DEFAULT 500000;

-- Liga que ainda está no valor antigo passa para a escala nova, senão ninguém
-- compra ninguém.
UPDATE "DraftLeague" SET "startingBudget" = 200000000 WHERE "startingBudget" <= 100000;
UPDATE "DraftLeague" SET "coinsWin" = 3000000 WHERE "coinsWin" <= 1000;
UPDATE "DraftLeague" SET "coinsDraw" = 1000000 WHERE "coinsDraw" <= 1000;
UPDATE "DraftLeague" SET "coinsLoss" = 400000 WHERE "coinsLoss" <= 1000;
UPDATE "DraftRoster" SET "budget" = 200000000, "earned" = 0, "spent" = 0 WHERE "budget" <= 100000;

-- Preço pelo overall, com a mesma curva do código (base 120 mil, fator 1.185 a
-- partir de 50), e salário em meio por cento do preço.
UPDATE "CatalogPlayer"
   SET "price" = GREATEST(1000, ROUND(120000 * POWER(1.185, LEAST(99, GREATEST(40, "overall")) - 50)))
 WHERE "price" <= 100000;

UPDATE "DraftPlayer"
   SET "price" = GREATEST(1000, ROUND(120000 * POWER(1.185, LEAST(99, GREATEST(40, "overall")) - 50)))
 WHERE "price" <= 100000;

UPDATE "DraftPlayer" SET "salary" = GREATEST(1000, ROUND("price" / 200.0));
