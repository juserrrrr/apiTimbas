-- Time sem dono: a liga pode começar sem gente suficiente, o time fica vago,
-- perde por W.O. enquanto ninguém assume e some da fila quando alguém entra.
ALTER TABLE "DraftRoster" DROP CONSTRAINT IF EXISTS "DraftRoster_userId_fkey";
ALTER TABLE "DraftRoster" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "DraftRoster"
  ADD CONSTRAINT "DraftRoster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
