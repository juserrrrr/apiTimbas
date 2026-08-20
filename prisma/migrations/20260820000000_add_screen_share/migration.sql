CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

INSERT INTO "FeatureFlag" ("key", "enabled", "description", "updatedAt")
VALUES ('screen_share', false, 'Transmissão de tela ao vivo no dashboard', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
