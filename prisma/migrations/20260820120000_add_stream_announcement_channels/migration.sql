CREATE TABLE "StreamAnnouncementChannel" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "dateUpdated" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StreamAnnouncementChannel_pkey" PRIMARY KEY ("guildId")
);
