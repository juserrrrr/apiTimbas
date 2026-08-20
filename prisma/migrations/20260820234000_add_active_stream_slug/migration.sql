ALTER TABLE "ActiveStream" ADD COLUMN "slug" TEXT;

WITH normalized AS (
  SELECT
    "id",
    "hostUserId",
    COALESCE(
      NULLIF(
        TRIM(BOTH '-' FROM LOWER(REGEXP_REPLACE("hostName", '[^a-zA-Z0-9._-]+', '-', 'g'))),
        ''
      ),
      'live'
    ) AS "base"
  FROM "ActiveStream"
), ranked AS (
  SELECT
    "id",
    "hostUserId",
    "base",
    ROW_NUMBER() OVER (PARTITION BY "base" ORDER BY "hostUserId") AS "position"
  FROM normalized
)
UPDATE "ActiveStream" AS stream
SET "slug" = CASE
  WHEN ranked."position" = 1 THEN ranked."base"
  ELSE ranked."base" || '-' || ranked."hostUserId"
END
FROM ranked
WHERE stream."id" = ranked."id";

ALTER TABLE "ActiveStream" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "ActiveStream_slug_key" ON "ActiveStream"("slug");
