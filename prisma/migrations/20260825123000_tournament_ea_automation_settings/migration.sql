CREATE TABLE "TournamentEaAutomationSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "checkIntervalSeconds" INTEGER NOT NULL DEFAULT 30,
  "checksPerMinute" INTEGER NOT NULL DEFAULT 2,
  "updatedByDiscordId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentEaAutomationSettings_pkey" PRIMARY KEY ("id")
);
