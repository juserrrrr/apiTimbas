-- Economia na escala do futebol de verdade, em reais.
--
-- Um craque de 95 vale perto de R$ 1,4 bi, o que passa do teto do inteiro de 32
-- bits (2,14 bi) assim que alguém junta caixa. Dinheiro passa a ser double
-- precision: guarda real inteiro exato até a casa dos quatrilhões e continua
-- chegando no TypeScript como number, sem virar BigInt no código todo.

ALTER TABLE "CatalogPlayer" ALTER COLUMN "price" TYPE DOUBLE PRECISION;

ALTER TABLE "DraftLeague" ALTER COLUMN "startingBudget" TYPE DOUBLE PRECISION;
ALTER TABLE "DraftLeague" ALTER COLUMN "startingBudget" SET DEFAULT 800000000;

ALTER TABLE "DraftPlayer" ALTER COLUMN "price" TYPE DOUBLE PRECISION;
ALTER TABLE "DraftPlayer" ALTER COLUMN "salary" TYPE DOUBLE PRECISION;

ALTER TABLE "DraftRoster" ALTER COLUMN "budget" TYPE DOUBLE PRECISION;
ALTER TABLE "DraftRoster" ALTER COLUMN "earned" TYPE DOUBLE PRECISION;
ALTER TABLE "DraftRoster" ALTER COLUMN "spent" TYPE DOUBLE PRECISION;

ALTER TABLE "DraftPick" ALTER COLUMN "price" TYPE DOUBLE PRECISION;

ALTER TABLE "DraftAuction" ALTER COLUMN "startingBid" TYPE DOUBLE PRECISION;
ALTER TABLE "DraftAuction" ALTER COLUMN "currentBid" TYPE DOUBLE PRECISION;
ALTER TABLE "DraftAuctionBid" ALTER COLUMN "amount" TYPE DOUBLE PRECISION;

ALTER TABLE "DraftBudgetEntry" ALTER COLUMN "amount" TYPE DOUBLE PRECISION;
ALTER TABLE "DraftBudgetEntry" ALTER COLUMN "balanceAfter" TYPE DOUBLE PRECISION;

ALTER TABLE "TransferOffer" ALTER COLUMN "price" TYPE DOUBLE PRECISION;

-- A mesma curva de src/football/market-value.ts, para a base que já existe não
-- ficar com preço da escala antiga enquanto o mercado cobra na nova.
CREATE OR REPLACE FUNCTION timbas_market_value(overall INT) RETURNS DOUBLE PRECISION AS $$
DECLARE
  level INT := LEAST(99, GREATEST(40, overall));
  raw DOUBLE PRECISION;
BEGIN
  raw := 400000 * power(1.215, LEAST(level, 88) - 50) * power(1.115, GREATEST(level - 88, 0));
  IF raw >= 100000000 THEN RETURN round(raw / 5000000) * 5000000; END IF;
  IF raw >= 10000000 THEN RETURN round(raw / 500000) * 500000; END IF;
  IF raw >= 1000000 THEN RETURN round(raw / 100000) * 100000; END IF;
  IF raw >= 100000 THEN RETURN round(raw / 10000) * 10000; END IF;
  RETURN round(raw / 1000) * 1000;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE "CatalogPlayer" SET "price" = timbas_market_value("overall");

UPDATE "DraftPlayer"
SET "price" = timbas_market_value("overall"),
    "salary" = GREATEST(10000, round(timbas_market_value("overall") / 250 / 1000) * 1000);

-- Liga que nasceu no caixa antigo sobe junto, mantendo a fração de caixa que
-- cada elenco tinha gastado.
UPDATE "DraftRoster" r
SET "budget" = r."budget" * 4,
    "earned" = r."earned" * 4,
    "spent" = r."spent" * 4
FROM "DraftLeague" l
WHERE r."leagueId" = l."id" AND l."startingBudget" = 200000000;

UPDATE "DraftBudgetEntry" e
SET "amount" = e."amount" * 4,
    "balanceAfter" = e."balanceAfter" * 4
FROM "DraftLeague" l
WHERE e."leagueId" = l."id" AND l."startingBudget" = 200000000;

UPDATE "DraftLeague" SET "startingBudget" = 800000000 WHERE "startingBudget" = 200000000;

DROP FUNCTION timbas_market_value(INT);

-- A bilheteria da rodada tem que acompanhar a folha, senão todo clube quebra.
ALTER TABLE "DraftLeague" ALTER COLUMN "coinsWin" TYPE DOUBLE PRECISION;
ALTER TABLE "DraftLeague" ALTER COLUMN "coinsDraw" TYPE DOUBLE PRECISION;
ALTER TABLE "DraftLeague" ALTER COLUMN "coinsLoss" TYPE DOUBLE PRECISION;
ALTER TABLE "DraftLeague" ALTER COLUMN "coinsWin" SET DEFAULT 15000000;
ALTER TABLE "DraftLeague" ALTER COLUMN "coinsDraw" SET DEFAULT 6000000;
ALTER TABLE "DraftLeague" ALTER COLUMN "coinsLoss" SET DEFAULT 2000000;

UPDATE "DraftLeague"
SET "coinsWin" = 15000000, "coinsDraw" = 6000000, "coinsLoss" = 2000000
WHERE "coinsWin" <= 3000000;
