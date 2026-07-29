-- League Classic saiu em 2026-07-29 e roda na Fenda da Season 3, então
-- "CLASSIC" virou um nome ambíguo: as partidas gravadas até aqui foram todas
-- na Fenda atual. Renomeia o valor existente (preserva as linhas, já que o
-- rótulo muda mas o valor do enum é o mesmo) e adiciona o modo novo.

-- AlterEnum: CLASSIC sempre significou a Fenda atual
ALTER TYPE "GameMode" RENAME VALUE 'CLASSIC' TO 'SUMMONERS_RIFT';

-- AlterEnum: BEFORE 'ARAM' mantém a ordem física igual à do schema.prisma
ALTER TYPE "GameMode" ADD VALUE 'LOL_CLASSIC' BEFORE 'ARAM';

-- O default acompanha o rename, mas deixamos explícito para o schema não divergir.
ALTER TABLE "CustomLeagueMatch" ALTER COLUMN "gameMode" SET DEFAULT 'SUMMONERS_RIFT';
