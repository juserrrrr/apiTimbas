-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'APPROVED', 'BLOCKED');

-- Quem já existe entra aprovado, senão o time perde o acesso na subida.
ALTER TABLE "User"
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "statusNote" TEXT,
  ADD COLUMN "reviewedByUserId" INTEGER,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateTable
CREATE TABLE "PermissionGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PermissionGroup_name_key" ON "PermissionGroup"("name");

CREATE TABLE "UserGroupMember" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserGroupMember_userId_groupId_key" ON "UserGroupMember"("userId", "groupId");
CREATE INDEX "UserGroupMember_groupId_idx" ON "UserGroupMember"("groupId");

ALTER TABLE "UserGroupMember"
  ADD CONSTRAINT "UserGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "UserGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PermissionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlatformSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "requireApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvalMessage" TEXT,
    "updatedByDiscordId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);
