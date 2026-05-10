-- CreateTable
CREATE TABLE "ClashAnalysis" (
    "id" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClashAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClashAnalysis_createdAt_idx" ON "ClashAnalysis"("createdAt");
