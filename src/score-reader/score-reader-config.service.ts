import { Injectable } from '@nestjs/common';
import { ScoreReaderConfig, ScoreReaderProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from './secret.crypto';

export interface ResolvedScoreReaderConfig {
  enabled: boolean;
  provider: ScoreReaderProvider;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  ocrBaseUrl: string | null;
  ocrApiKey: string | null;
  ocrEngine: string;
  timeoutMs: number;
  maxImageBytes: number;
}

export interface ScoreReaderConfigView {
  enabled: boolean;
  provider: ScoreReaderProvider;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  ocrBaseUrl: string | null;
  hasOcrApiKey: boolean;
  ocrEngine: string | null;
  timeoutMs: number;
  maxImageBytes: number;
  lastCheckedAt: Date | null;
  lastCheckOk: boolean | null;
  lastCheckMessage: string | null;
  updatedAt: Date;
  ready: boolean;
}

export interface ScoreReaderConfigPatch {
  enabled?: boolean;
  provider?: ScoreReaderProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string | null;
  ocrBaseUrl?: string | null;
  ocrApiKey?: string | null;
  ocrEngine?: string | null;
  timeoutMs?: number;
  maxImageBytes?: number;
}

@Injectable()
export class ScoreReaderConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async load(): Promise<ResolvedScoreReaderConfig> {
    const row = await this.row();
    return {
      enabled: row.enabled,
      provider: row.provider,
      baseUrl: row.baseUrl.replace(/\/+$/, ''),
      model: row.model,
      apiKey: row.apiKeyCipher ? decryptSecret(row.apiKeyCipher) : null,
      ocrBaseUrl: row.ocrBaseUrl?.replace(/\/+$/, '') ?? null,
      ocrApiKey: row.ocrApiKeyCipher ? decryptSecret(row.ocrApiKeyCipher) : null,
      ocrEngine: row.ocrEngine ?? 'generic',
      timeoutMs: row.timeoutMs,
      maxImageBytes: row.maxImageBytes,
    };
  }

  async view(): Promise<ScoreReaderConfigView> {
    const row = await this.row();
    return this.toView(row);
  }

  async update(patch: ScoreReaderConfigPatch, updatedByDiscordId: string): Promise<ScoreReaderConfigView> {
    await this.row();
    const data: Record<string, unknown> = { updatedByDiscordId };

    for (const field of ['enabled', 'provider', 'model', 'timeoutMs', 'maxImageBytes'] as const) {
      if (patch[field] !== undefined) data[field] = patch[field];
    }
    if (patch.baseUrl !== undefined) data.baseUrl = patch.baseUrl.replace(/\/+$/, '');
    if (patch.ocrBaseUrl !== undefined) {
      data.ocrBaseUrl = patch.ocrBaseUrl ? patch.ocrBaseUrl.replace(/\/+$/, '') : null;
    }
    if (patch.ocrEngine !== undefined) data.ocrEngine = patch.ocrEngine || null;
    if (patch.apiKey !== undefined) {
      data.apiKeyCipher = patch.apiKey ? encryptSecret(patch.apiKey) : null;
    }
    if (patch.ocrApiKey !== undefined) {
      data.ocrApiKeyCipher = patch.ocrApiKey ? encryptSecret(patch.ocrApiKey) : null;
    }

    const updated = await this.prisma.scoreReaderConfig.update({ where: { id: 1 }, data });
    return this.toView(updated);
  }

  async recordCheck(ok: boolean, message: string): Promise<ScoreReaderConfigView> {
    const updated = await this.prisma.scoreReaderConfig.update({
      where: { id: 1 },
      data: { lastCheckedAt: new Date(), lastCheckOk: ok, lastCheckMessage: message.slice(0, 300) },
    });
    return this.toView(updated);
  }

  private async row(): Promise<ScoreReaderConfig> {
    return this.prisma.scoreReaderConfig.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
  }

  private toView(row: ScoreReaderConfig): ScoreReaderConfigView {
    const hasApiKey = Boolean(row.apiKeyCipher);
    const needsOcr = row.provider === ScoreReaderProvider.OCR_TEXT;
    return {
      enabled: row.enabled,
      provider: row.provider,
      baseUrl: row.baseUrl,
      model: row.model,
      hasApiKey,
      ocrBaseUrl: row.ocrBaseUrl,
      hasOcrApiKey: Boolean(row.ocrApiKeyCipher),
      ocrEngine: row.ocrEngine,
      timeoutMs: row.timeoutMs,
      maxImageBytes: row.maxImageBytes,
      lastCheckedAt: row.lastCheckedAt,
      lastCheckOk: row.lastCheckOk,
      lastCheckMessage: row.lastCheckMessage,
      updatedAt: row.updatedAt,
      ready: row.enabled && hasApiKey && (!needsOcr || Boolean(row.ocrBaseUrl)),
    };
  }
}
