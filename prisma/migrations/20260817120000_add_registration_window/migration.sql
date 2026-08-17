-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "autoStartOnClose" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registrationEndsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DraftLeague" ADD COLUMN     "autoStartOnClose" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registrationEndsAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Tournament_status_registrationEndsAt_idx" ON "Tournament"("status", "registrationEndsAt");

-- CreateIndex
CREATE INDEX "DraftLeague_status_registrationEndsAt_idx" ON "DraftLeague"("status", "registrationEndsAt");
