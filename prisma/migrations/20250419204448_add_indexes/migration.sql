-- CreateIndex
CREATE INDEX "CustomLeagueMatch_winnerId_idx" ON "CustomLeagueMatch"("winnerId");

-- CreateIndex
CREATE INDEX "CustomLeagueMatch_ServerDiscordId_idx" ON "CustomLeagueMatch"("ServerDiscordId");

-- CreateIndex
CREATE INDEX "DiscordServer_discordServerId_idx" ON "DiscordServer"("discordServerId");

-- CreateIndex
CREATE INDEX "TeamLeague_side_idx" ON "TeamLeague"("side");

-- CreateIndex
CREATE INDEX "TeamLeague_customLeagueMatchId_idx" ON "TeamLeague"("customLeagueMatchId");

-- CreateIndex
CREATE INDEX "User_leaguePuuid_idx" ON "User"("leaguePuuid");

-- CreateIndex
CREATE INDEX "UserTeamLeague_userId_idx" ON "UserTeamLeague"("userId");

-- CreateIndex
CREATE INDEX "UserTeamLeague_teamLeagueId_idx" ON "UserTeamLeague"("teamLeagueId");
