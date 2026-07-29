ALTER TABLE "CustomLeagueMatch"
ADD COLUMN "discordChannelId" TEXT,
ADD COLUMN "discordMessageId" TEXT;

CREATE INDEX "CustomLeagueMatch_discordMessageId_idx"
ON "CustomLeagueMatch"("discordMessageId");
