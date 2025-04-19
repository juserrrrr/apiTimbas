-- DropForeignKey
ALTER TABLE "DiscordServer" DROP CONSTRAINT "DiscordServer_doorMessageId_fkey";

-- AlterTable
ALTER TABLE "DiscordServer" ALTER COLUMN "doorMessageId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "DiscordServer" ADD CONSTRAINT "DiscordServer_doorMessageId_fkey" FOREIGN KEY ("doorMessageId") REFERENCES "DoorMessages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomLeagueMatch" ADD CONSTRAINT "CustomLeagueMatch_ServerDiscordId_fkey" FOREIGN KEY ("ServerDiscordId") REFERENCES "DiscordServer"("discordServerId") ON DELETE RESTRICT ON UPDATE CASCADE;
