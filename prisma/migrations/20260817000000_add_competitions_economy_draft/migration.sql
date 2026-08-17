-- CreateEnum
CREATE TYPE "CompetitionGame" AS ENUM ('EA_FC', 'LOL', 'VALORANT', 'CS', 'ROCKET_LEAGUE', 'OTHER');

-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'GROUPS_KNOCKOUT');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTRATION', 'RUNNING', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TournamentPhase" AS ENUM ('GROUP', 'LEAGUE', 'WINNERS', 'LOSERS', 'GRAND_FINAL', 'THIRD_PLACE');

-- CreateEnum
CREATE TYPE "TournamentMatchStatus" AS ENUM ('PENDING', 'READY', 'AWAITING_PROOF', 'DISPUTED', 'FINISHED', 'WALKOVER');

-- CreateEnum
CREATE TYPE "MatchSlot" AS ENUM ('HOME', 'AWAY');

-- CreateEnum
CREATE TYPE "CompetitionRole" AS ENUM ('OWNER', 'MODERATOR');

-- CreateEnum
CREATE TYPE "MatchProofStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ScoreReaderProvider" AS ENUM ('VISION', 'OCR_TEXT');

-- CreateEnum
CREATE TYPE "WalletTxType" AS ENUM ('MATCH_WIN', 'MATCH_DRAW', 'MATCH_LOSS', 'TOURNAMENT_PRIZE', 'DRAFT_SALE', 'DRAFT_PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADMIN_ADJUST');

-- CreateEnum
CREATE TYPE "DraftLeagueStatus" AS ENUM ('SETUP', 'DRAFTING', 'ACTIVE', 'FINISHED');

-- CreateEnum
CREATE TYPE "DraftOrderType" AS ENUM ('SNAKE', 'LINEAR');

-- CreateEnum
CREATE TYPE "DraftMatchStatus" AS ENUM ('SCHEDULED', 'AWAITING_PROOF', 'FINISHED');

-- CreateEnum
CREATE TYPE "TransferOfferKind" AS ENUM ('BUY_FREE_AGENT', 'BUY_FROM_ROSTER', 'SWAP');

-- CreateEnum
CREATE TYPE "TransferOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "game" "CompetitionGame" NOT NULL DEFAULT 'EA_FC',
    "gameLabel" TEXT,
    "format" "TournamentFormat" NOT NULL DEFAULT 'SINGLE_ELIMINATION',
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "maxTeams" INTEGER NOT NULL DEFAULT 8,
    "teamSize" INTEGER NOT NULL DEFAULT 1,
    "groupCount" INTEGER NOT NULL DEFAULT 2,
    "advancePerGroup" INTEGER NOT NULL DEFAULT 2,
    "legs" INTEGER NOT NULL DEFAULT 1,
    "thirdPlace" BOOLEAN NOT NULL DEFAULT false,
    "allowDraws" BOOLEAN NOT NULL DEFAULT true,
    "pointsWin" INTEGER NOT NULL DEFAULT 3,
    "pointsDraw" INTEGER NOT NULL DEFAULT 1,
    "pointsLoss" INTEGER NOT NULL DEFAULT 0,
    "coinsWin" INTEGER NOT NULL DEFAULT 50,
    "coinsDraw" INTEGER NOT NULL DEFAULT 20,
    "coinsLoss" INTEGER NOT NULL DEFAULT 5,
    "coinsChampion" INTEGER NOT NULL DEFAULT 500,
    "coinsRunnerUp" INTEGER NOT NULL DEFAULT 200,
    "requireProof" BOOLEAN NOT NULL DEFAULT true,
    "autoApproveProof" BOOLEAN NOT NULL DEFAULT true,
    "autoApproveMinConfidence" INTEGER NOT NULL DEFAULT 80,
    "createdByDiscordId" TEXT NOT NULL,
    "bannerUrl" TEXT,
    "startsAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "championTeamId" TEXT,
    "runnerUpTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentStaff" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "CompetitionRole" NOT NULL DEFAULT 'MODERATOR',
    "addedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentTeam" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT,
    "logoUrl" TEXT,
    "seed" INTEGER,
    "groupId" TEXT,
    "ownerDiscordId" TEXT,
    "eaClubId" TEXT,
    "eliminated" BOOLEAN NOT NULL DEFAULT false,
    "played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "scoreFor" INTEGER NOT NULL DEFAULT 0,
    "scoreAgainst" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentTeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "captain" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TournamentTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentGroup" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "TournamentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentMatch" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "groupId" TEXT,
    "phase" "TournamentPhase" NOT NULL DEFAULT 'WINNERS',
    "round" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "leg" INTEGER NOT NULL DEFAULT 1,
    "label" TEXT,
    "homeTeamId" TEXT,
    "awayTeamId" TEXT,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "winnerTeamId" TEXT,
    "status" "TournamentMatchStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3),
    "playedAt" TIMESTAMP(3),
    "reportedByDiscordId" TEXT,
    "nextMatchId" TEXT,
    "nextMatchSlot" "MatchSlot",
    "loserNextMatchId" TEXT,
    "loserNextMatchSlot" "MatchSlot",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreReaderConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" "ScoreReaderProvider" NOT NULL DEFAULT 'VISION',
    "baseUrl" TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "apiKeyCipher" TEXT,
    "ocrBaseUrl" TEXT,
    "ocrApiKeyCipher" TEXT,
    "ocrEngine" TEXT,
    "timeoutMs" INTEGER NOT NULL DEFAULT 45000,
    "maxImageBytes" INTEGER NOT NULL DEFAULT 4194304,
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckOk" BOOLEAN,
    "lastCheckMessage" TEXT,
    "updatedByDiscordId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoreReaderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchProof" (
    "id" TEXT NOT NULL,
    "matchId" TEXT,
    "draftMatchId" TEXT,
    "submittedByDiscordId" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "claimedHomeScore" INTEGER NOT NULL,
    "claimedAwayScore" INTEGER NOT NULL,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "aiHomeScore" INTEGER,
    "aiAwayScore" INTEGER,
    "aiConfidence" INTEGER,
    "aiAgrees" BOOLEAN,
    "aiNotes" TEXT,
    "aiRaw" JSONB,
    "status" "MatchProofStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByDiscordId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalEarned" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" "WalletTxType" NOT NULL,
    "description" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftLeague" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "DraftLeagueStatus" NOT NULL DEFAULT 'SETUP',
    "orderType" "DraftOrderType" NOT NULL DEFAULT 'SNAKE',
    "rosterSize" INTEGER NOT NULL DEFAULT 11,
    "formation" TEXT NOT NULL DEFAULT '4-3-3',
    "pickSeconds" INTEGER NOT NULL DEFAULT 120,
    "matchDays" INTEGER[] DEFAULT ARRAY[0, 3]::INTEGER[],
    "matchHour" INTEGER NOT NULL DEFAULT 21,
    "totalRounds" INTEGER NOT NULL DEFAULT 0,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "currentPickNumber" INTEGER NOT NULL DEFAULT 0,
    "pickDeadline" TIMESTAMP(3),
    "pointsWin" INTEGER NOT NULL DEFAULT 3,
    "pointsDraw" INTEGER NOT NULL DEFAULT 1,
    "coinsWin" INTEGER NOT NULL DEFAULT 60,
    "coinsDraw" INTEGER NOT NULL DEFAULT 25,
    "coinsLoss" INTEGER NOT NULL DEFAULT 10,
    "transferWindowOpen" BOOLEAN NOT NULL DEFAULT true,
    "createdByDiscordId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftLeague_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftStaff" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "CompetitionRole" NOT NULL DEFAULT 'MODERATOR',
    "addedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftPlayer" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "overall" INTEGER NOT NULL DEFAULT 70,
    "realTeam" TEXT,
    "nationality" TEXT,
    "photoUrl" TEXT,
    "price" INTEGER NOT NULL DEFAULT 100,
    "rosterId" TEXT,
    "starter" BOOLEAN NOT NULL DEFAULT false,
    "slot" TEXT,
    "appearances" INTEGER NOT NULL DEFAULT 0,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftRoster" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT,
    "logoUrl" TEXT,
    "formation" TEXT NOT NULL DEFAULT '4-3-3',
    "draftOrder" INTEGER NOT NULL DEFAULT 0,
    "played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "goalsFor" INTEGER NOT NULL DEFAULT 0,
    "goalsAgainst" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftPick" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "pickNumber" INTEGER NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftMatch" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "homeRosterId" TEXT NOT NULL,
    "awayRosterId" TEXT NOT NULL,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "status" "DraftMatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "playedAt" TIMESTAMP(3),
    "reportedByDiscordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferOffer" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "kind" "TransferOfferKind" NOT NULL,
    "playerId" TEXT NOT NULL,
    "fromRosterId" TEXT NOT NULL,
    "toRosterId" TEXT,
    "offeredPlayerId" TEXT,
    "price" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "status" "TransferOfferStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_slug_key" ON "Tournament"("slug");

-- CreateIndex
CREATE INDEX "Tournament_status_idx" ON "Tournament"("status");

-- CreateIndex
CREATE INDEX "Tournament_game_idx" ON "Tournament"("game");

-- CreateIndex
CREATE INDEX "Tournament_status_startsAt_idx" ON "Tournament"("status", "startsAt");

-- CreateIndex
CREATE INDEX "TournamentStaff_userId_idx" ON "TournamentStaff"("userId");

-- CreateIndex
CREATE INDEX "TournamentStaff_tournamentId_role_idx" ON "TournamentStaff"("tournamentId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentStaff_tournamentId_userId_key" ON "TournamentStaff"("tournamentId", "userId");

-- CreateIndex
CREATE INDEX "TournamentTeam_tournamentId_groupId_idx" ON "TournamentTeam"("tournamentId", "groupId");

-- CreateIndex
CREATE INDEX "TournamentTeam_ownerDiscordId_idx" ON "TournamentTeam"("ownerDiscordId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentTeam_tournamentId_name_key" ON "TournamentTeam"("tournamentId", "name");

-- CreateIndex
CREATE INDEX "TournamentTeamMember_userId_idx" ON "TournamentTeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentTeamMember_teamId_userId_key" ON "TournamentTeamMember"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentGroup_tournamentId_order_key" ON "TournamentGroup"("tournamentId", "order");

-- CreateIndex
CREATE INDEX "TournamentMatch_tournamentId_status_idx" ON "TournamentMatch"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "TournamentMatch_tournamentId_phase_round_idx" ON "TournamentMatch"("tournamentId", "phase", "round");

-- CreateIndex
CREATE INDEX "TournamentMatch_homeTeamId_idx" ON "TournamentMatch"("homeTeamId");

-- CreateIndex
CREATE INDEX "TournamentMatch_awayTeamId_idx" ON "TournamentMatch"("awayTeamId");

-- CreateIndex
CREATE INDEX "TournamentMatch_scheduledAt_idx" ON "TournamentMatch"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatch_tournamentId_phase_round_position_leg_key" ON "TournamentMatch"("tournamentId", "phase", "round", "position", "leg");

-- CreateIndex
CREATE INDEX "MatchProof_matchId_status_idx" ON "MatchProof"("matchId", "status");

-- CreateIndex
CREATE INDEX "MatchProof_draftMatchId_status_idx" ON "MatchProof"("draftMatchId", "status");

-- CreateIndex
CREATE INDEX "MatchProof_status_createdAt_idx" ON "MatchProof"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_balance_idx" ON "Wallet"("balance");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_referenceType_referenceId_idx" ON "WalletTransaction"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "DraftLeague_status_idx" ON "DraftLeague"("status");

-- CreateIndex
CREATE INDEX "DraftStaff_userId_idx" ON "DraftStaff"("userId");

-- CreateIndex
CREATE INDEX "DraftStaff_leagueId_role_idx" ON "DraftStaff"("leagueId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "DraftStaff_leagueId_userId_key" ON "DraftStaff"("leagueId", "userId");

-- CreateIndex
CREATE INDEX "DraftPlayer_leagueId_rosterId_idx" ON "DraftPlayer"("leagueId", "rosterId");

-- CreateIndex
CREATE INDEX "DraftPlayer_leagueId_position_idx" ON "DraftPlayer"("leagueId", "position");

-- CreateIndex
CREATE INDEX "DraftPlayer_leagueId_overall_idx" ON "DraftPlayer"("leagueId", "overall");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPlayer_leagueId_name_key" ON "DraftPlayer"("leagueId", "name");

-- CreateIndex
CREATE INDEX "DraftRoster_leagueId_points_idx" ON "DraftRoster"("leagueId", "points");

-- CreateIndex
CREATE UNIQUE INDEX "DraftRoster_leagueId_userId_key" ON "DraftRoster"("leagueId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftRoster_leagueId_name_key" ON "DraftRoster"("leagueId", "name");

-- CreateIndex
CREATE INDEX "DraftPick_rosterId_idx" ON "DraftPick"("rosterId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_leagueId_playerId_key" ON "DraftPick"("leagueId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_leagueId_pickNumber_key" ON "DraftPick"("leagueId", "pickNumber");

-- CreateIndex
CREATE INDEX "DraftMatch_leagueId_round_idx" ON "DraftMatch"("leagueId", "round");

-- CreateIndex
CREATE INDEX "DraftMatch_leagueId_scheduledAt_idx" ON "DraftMatch"("leagueId", "scheduledAt");

-- CreateIndex
CREATE INDEX "DraftMatch_leagueId_status_idx" ON "DraftMatch"("leagueId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DraftMatch_leagueId_round_homeRosterId_key" ON "DraftMatch"("leagueId", "round", "homeRosterId");

-- CreateIndex
CREATE INDEX "TransferOffer_leagueId_status_idx" ON "TransferOffer"("leagueId", "status");

-- CreateIndex
CREATE INDEX "TransferOffer_toRosterId_status_idx" ON "TransferOffer"("toRosterId", "status");

-- CreateIndex
CREATE INDEX "TransferOffer_fromRosterId_status_idx" ON "TransferOffer"("fromRosterId", "status");

-- AddForeignKey
ALTER TABLE "TournamentStaff" ADD CONSTRAINT "TournamentStaff_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentStaff" ADD CONSTRAINT "TournamentStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeam" ADD CONSTRAINT "TournamentTeam_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeam" ADD CONSTRAINT "TournamentTeam_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TournamentGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeamMember" ADD CONSTRAINT "TournamentTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "TournamentTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeamMember" ADD CONSTRAINT "TournamentTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGroup" ADD CONSTRAINT "TournamentGroup_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TournamentGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "TournamentTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "TournamentTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_nextMatchId_fkey" FOREIGN KEY ("nextMatchId") REFERENCES "TournamentMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_loserNextMatchId_fkey" FOREIGN KEY ("loserNextMatchId") REFERENCES "TournamentMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchProof" ADD CONSTRAINT "MatchProof_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "TournamentMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchProof" ADD CONSTRAINT "MatchProof_draftMatchId_fkey" FOREIGN KEY ("draftMatchId") REFERENCES "DraftMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftStaff" ADD CONSTRAINT "DraftStaff_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "DraftLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftStaff" ADD CONSTRAINT "DraftStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPlayer" ADD CONSTRAINT "DraftPlayer_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "DraftLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPlayer" ADD CONSTRAINT "DraftPlayer_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "DraftRoster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftRoster" ADD CONSTRAINT "DraftRoster_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "DraftLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftRoster" ADD CONSTRAINT "DraftRoster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "DraftLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "DraftRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "DraftPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftMatch" ADD CONSTRAINT "DraftMatch_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "DraftLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftMatch" ADD CONSTRAINT "DraftMatch_homeRosterId_fkey" FOREIGN KEY ("homeRosterId") REFERENCES "DraftRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftMatch" ADD CONSTRAINT "DraftMatch_awayRosterId_fkey" FOREIGN KEY ("awayRosterId") REFERENCES "DraftRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOffer" ADD CONSTRAINT "TransferOffer_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "DraftLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOffer" ADD CONSTRAINT "TransferOffer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "DraftPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOffer" ADD CONSTRAINT "TransferOffer_fromRosterId_fkey" FOREIGN KEY ("fromRosterId") REFERENCES "DraftRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOffer" ADD CONSTRAINT "TransferOffer_toRosterId_fkey" FOREIGN KEY ("toRosterId") REFERENCES "DraftRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

