DROP INDEX IF EXISTS "EaClubMatch_externalMatchId_key";

CREATE UNIQUE INDEX "EaClubMatch_clubId_externalMatchId_key"
ON "EaClubMatch"("clubId", "externalMatchId");
