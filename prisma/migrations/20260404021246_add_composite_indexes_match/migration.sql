-- CreateIndex
CREATE INDEX "CustomLeagueMatch_ServerDiscordId_status_idx" ON "CustomLeagueMatch"("ServerDiscordId", "status");

-- CreateIndex
CREATE INDEX "CustomLeagueMatch_ServerDiscordId_winnerId_idx" ON "CustomLeagueMatch"("ServerDiscordId", "winnerId");
