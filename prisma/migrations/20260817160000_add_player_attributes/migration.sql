-- Atributos do card na base global e na cópia por liga.
ALTER TABLE "CatalogPlayer"
  ADD COLUMN "pace" INTEGER,
  ADD COLUMN "shooting" INTEGER,
  ADD COLUMN "passing" INTEGER,
  ADD COLUMN "dribbling" INTEGER,
  ADD COLUMN "defending" INTEGER,
  ADD COLUMN "physical" INTEGER,
  ADD COLUMN "attributesModel" TEXT,
  ADD COLUMN "attributesNote" TEXT,
  ADD COLUMN "attributesAt" TIMESTAMP(3);

ALTER TABLE "DraftPlayer"
  ADD COLUMN "catalogPlayerId" TEXT,
  ADD COLUMN "pace" INTEGER,
  ADD COLUMN "shooting" INTEGER,
  ADD COLUMN "passing" INTEGER,
  ADD COLUMN "dribbling" INTEGER,
  ADD COLUMN "defending" INTEGER,
  ADD COLUMN "physical" INTEGER;

CREATE INDEX "DraftPlayer_catalogPlayerId_idx" ON "DraftPlayer"("catalogPlayerId");

ALTER TABLE "DraftPlayer"
  ADD CONSTRAINT "DraftPlayer_catalogPlayerId_fkey"
  FOREIGN KEY ("catalogPlayerId") REFERENCES "CatalogPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
