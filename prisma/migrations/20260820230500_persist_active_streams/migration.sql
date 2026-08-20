CREATE TABLE "ActiveStream" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hostUserId" INTEGER NOT NULL,
    "hostName" TEXT NOT NULL,
    "hostAvatar" TEXT,
    "hostDiscordId" TEXT,
    "guildId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'MEMBERS',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "broadcasting" BOOLEAN NOT NULL DEFAULT false,
    "announced" BOOLEAN NOT NULL DEFAULT false,
    "dateUpdated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveStream_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActiveStream_hostUserId_key" ON "ActiveStream"("hostUserId");
