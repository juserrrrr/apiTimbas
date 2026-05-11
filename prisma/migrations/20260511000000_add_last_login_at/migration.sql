-- Store when the user last authenticated through the site.
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
