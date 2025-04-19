-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('WELCOME', 'GOODBYE', 'BAN');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('BLUE', 'RED');

-- CreateTable
CREATE TABLE "DiscordServer" (
    "id" SERIAL NOT NULL,
    "discordServerId" TEXT NOT NULL,
    "doorMessageId" INTEGER NOT NULL,
    "dateCreated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateUpdated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoorMessages" (
    "id" SERIAL NOT NULL,
    "welcomeMessageId" INTEGER,
    "goodbyeMessageId" INTEGER,
    "banMessageId" INTEGER,
    "channelId" TEXT,

    CONSTRAINT "DoorMessages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "isEmbed" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT,
    "messageType" "MessageType" NOT NULL DEFAULT 'WELCOME',

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Embed" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "color" TEXT,
    "url" TEXT,
    "timestamp" BOOLEAN DEFAULT false,
    "messageId" INTEGER NOT NULL,

    CONSTRAINT "Embed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbedFooter" (
    "id" SERIAL NOT NULL,
    "text" TEXT,
    "iconUrl" TEXT,
    "embedId" INTEGER NOT NULL,

    CONSTRAINT "EmbedFooter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbedImage" (
    "id" SERIAL NOT NULL,
    "url" TEXT,
    "height" INTEGER,
    "width" INTEGER,
    "embedId" INTEGER NOT NULL,

    CONSTRAINT "EmbedImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbedThumbnail" (
    "id" SERIAL NOT NULL,
    "url" TEXT,
    "height" INTEGER,
    "width" INTEGER,
    "embedId" INTEGER NOT NULL,

    CONSTRAINT "EmbedThumbnail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbedAuthor" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "url" TEXT,
    "iconUrl" TEXT,
    "embedId" INTEGER NOT NULL,

    CONSTRAINT "EmbedAuthor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbedField" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "inline" BOOLEAN DEFAULT false,
    "embedId" INTEGER NOT NULL,

    CONSTRAINT "EmbedField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "discordId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "password" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "dateOfBirth" TIMESTAMP(3),
    "dateCreated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateUpdated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamLeague" (
    "id" SERIAL NOT NULL,
    "side" "Side" NOT NULL,
    "customLeagueMatchId" INTEGER,

    CONSTRAINT "TeamLeague_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTeamLeague" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "teamLeagueId" INTEGER NOT NULL,

    CONSTRAINT "UserTeamLeague_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomLeagueMatch" (
    "id" SERIAL NOT NULL,
    "teamBlueId" INTEGER NOT NULL,
    "teamRedId" INTEGER NOT NULL,
    "winnerId" INTEGER,
    "ServerDiscordId" TEXT NOT NULL,
    "dateCreated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateUpdated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomLeagueMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscordServer_discordServerId_key" ON "DiscordServer"("discordServerId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordServer_doorMessageId_key" ON "DiscordServer"("doorMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "DoorMessages_welcomeMessageId_key" ON "DoorMessages"("welcomeMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "DoorMessages_goodbyeMessageId_key" ON "DoorMessages"("goodbyeMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "DoorMessages_banMessageId_key" ON "DoorMessages"("banMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Embed_messageId_key" ON "Embed"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmbedFooter_embedId_key" ON "EmbedFooter"("embedId");

-- CreateIndex
CREATE UNIQUE INDEX "EmbedImage_embedId_key" ON "EmbedImage"("embedId");

-- CreateIndex
CREATE UNIQUE INDEX "EmbedThumbnail_embedId_key" ON "EmbedThumbnail"("embedId");

-- CreateIndex
CREATE UNIQUE INDEX "EmbedAuthor_embedId_key" ON "EmbedAuthor"("embedId");

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserTeamLeague_userId_teamLeagueId_key" ON "UserTeamLeague"("userId", "teamLeagueId");

-- AddForeignKey
ALTER TABLE "DiscordServer" ADD CONSTRAINT "DiscordServer_doorMessageId_fkey" FOREIGN KEY ("doorMessageId") REFERENCES "DoorMessages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoorMessages" ADD CONSTRAINT "DoorMessages_welcomeMessageId_fkey" FOREIGN KEY ("welcomeMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoorMessages" ADD CONSTRAINT "DoorMessages_goodbyeMessageId_fkey" FOREIGN KEY ("goodbyeMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoorMessages" ADD CONSTRAINT "DoorMessages_banMessageId_fkey" FOREIGN KEY ("banMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embed" ADD CONSTRAINT "Embed_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbedFooter" ADD CONSTRAINT "EmbedFooter_embedId_fkey" FOREIGN KEY ("embedId") REFERENCES "Embed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbedImage" ADD CONSTRAINT "EmbedImage_embedId_fkey" FOREIGN KEY ("embedId") REFERENCES "Embed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbedThumbnail" ADD CONSTRAINT "EmbedThumbnail_embedId_fkey" FOREIGN KEY ("embedId") REFERENCES "Embed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbedAuthor" ADD CONSTRAINT "EmbedAuthor_embedId_fkey" FOREIGN KEY ("embedId") REFERENCES "Embed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbedField" ADD CONSTRAINT "EmbedField_embedId_fkey" FOREIGN KEY ("embedId") REFERENCES "Embed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeague" ADD CONSTRAINT "TeamLeague_customLeagueMatchId_fkey" FOREIGN KEY ("customLeagueMatchId") REFERENCES "CustomLeagueMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeamLeague" ADD CONSTRAINT "UserTeamLeague_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeamLeague" ADD CONSTRAINT "UserTeamLeague_teamLeagueId_fkey" FOREIGN KEY ("teamLeagueId") REFERENCES "TeamLeague"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
