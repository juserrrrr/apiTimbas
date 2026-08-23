-- Configuração de integrações preenchida pelo painel admin, para o SFU das
-- lives não depender de variável de ambiente e redeploy.
CREATE TABLE "IntegrationSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("key")
);

INSERT INTO "FeatureFlag" ("key", "enabled", "description", "updatedAt")
VALUES ('live_sfu', false, 'Servidor de transmissão (SFU) para as lives', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
