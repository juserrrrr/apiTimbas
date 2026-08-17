-- CreateEnum
CREATE TYPE "DraftStartMode" AS ENUM ('LIVE', 'ASYNC');

-- Draft ao vivo: marca a hora de todo mundo se juntar e só abre quando os donos
-- dão pronto. Liga que já existe fica no assíncrono, que é como ela nasceu.
ALTER TABLE "DraftLeague"
  ADD COLUMN "startMode" "DraftStartMode" NOT NULL DEFAULT 'LIVE',
  ADD COLUMN "draftStartsAt" TIMESTAMP(3);

UPDATE "DraftLeague" SET "startMode" = 'ASYNC' WHERE "status" <> 'SETUP';

ALTER TABLE "DraftRoster" ADD COLUMN "readyAt" TIMESTAMP(3);
