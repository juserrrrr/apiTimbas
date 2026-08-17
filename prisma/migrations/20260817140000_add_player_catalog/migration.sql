-- CreateEnum
CREATE TYPE "CatalogSource" AS ENUM ('MANUAL', 'FOOTBALL_DATA', 'GENERIC');

-- CreateTable
CREATE TABLE "CatalogCompetition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "source" "CatalogSource" NOT NULL DEFAULT 'MANUAL',
    "sourcePath" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncOk" BOOLEAN,
    "lastSyncMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogCompetition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogTeam" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "crestUrl" TEXT,
    "source" "CatalogSource" NOT NULL DEFAULT 'MANUAL',
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogPlayer" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "overall" INTEGER NOT NULL DEFAULT 70,
    "nationality" TEXT,
    "birthDate" TIMESTAMP(3),
    "photoUrl" TEXT,
    "price" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" "CatalogSource" NOT NULL DEFAULT 'MANUAL',
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCompetition_code_key" ON "CatalogCompetition"("code");

-- CreateIndex
CREATE INDEX "CatalogTeam_competitionId_idx" ON "CatalogTeam"("competitionId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogTeam_competitionId_name_key" ON "CatalogTeam"("competitionId", "name");

-- CreateIndex
CREATE INDEX "CatalogPlayer_teamId_position_idx" ON "CatalogPlayer"("teamId", "position");

-- CreateIndex
CREATE INDEX "CatalogPlayer_name_idx" ON "CatalogPlayer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogPlayer_teamId_name_key" ON "CatalogPlayer"("teamId", "name");

-- AddForeignKey
ALTER TABLE "CatalogTeam" ADD CONSTRAINT "CatalogTeam_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "CatalogCompetition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogPlayer" ADD CONSTRAINT "CatalogPlayer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "CatalogTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
