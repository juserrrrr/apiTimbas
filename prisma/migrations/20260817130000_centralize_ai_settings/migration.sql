-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('GEMINI', 'DEEPSEEK', 'OPENAI');

-- CreateEnum
CREATE TYPE "ScoreReadMode" AS ENUM ('VISION', 'OCR_TEXT');

-- DropTable
DROP TABLE IF EXISTS "ScoreReaderConfig";

-- DropEnum
DROP TYPE IF EXISTS "ScoreReaderProvider";

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "analysisEnabled" BOOLEAN NOT NULL DEFAULT true,
    "analysisProvider" "AiProvider" NOT NULL DEFAULT 'GEMINI',
    "analysisModel" TEXT,
    "analysisFallbackModel" TEXT,
    "scoreReaderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scoreReaderProvider" "AiProvider" NOT NULL DEFAULT 'OPENAI',
    "scoreReaderModel" TEXT,
    "scoreReadMode" "ScoreReadMode" NOT NULL DEFAULT 'VISION',
    "ocrLanguage" TEXT NOT NULL DEFAULT 'por',
    "timeoutMs" INTEGER NOT NULL DEFAULT 45000,
    "maxImageBytes" INTEGER NOT NULL DEFAULT 4194304,
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckOk" BOOLEAN,
    "lastCheckMessage" TEXT,
    "updatedByDiscordId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);
