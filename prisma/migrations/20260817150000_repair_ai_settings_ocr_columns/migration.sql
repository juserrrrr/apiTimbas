-- Reconcilia bancos que aplicaram a migração de centralização da IA antes de ela
-- trocar o OCR externo pelo OCR local: lá o `AiSettings` nasceu com `ocrBaseUrl`
-- e `ocrEngine` e sem `ocrLanguage`, o que quebra toda leitura da tabela.
ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "ocrLanguage" TEXT NOT NULL DEFAULT 'por';
ALTER TABLE "AiSettings" DROP COLUMN IF EXISTS "ocrBaseUrl";
ALTER TABLE "AiSettings" DROP COLUMN IF EXISTS "ocrEngine";
