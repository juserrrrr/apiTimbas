import { Injectable } from '@nestjs/common';
import { AiProvider, AiSettings, ScoreReadMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderRegistry, ResolvedProvider } from './ai-provider.registry';

export interface AiFeatureConfig {
  enabled: boolean;
  provider: ResolvedProvider | null;
  unavailableReason: string | null;
}

export interface UpdateAiSettingsInput {
  analysisEnabled?: boolean;
  analysisProvider?: AiProvider;
  analysisModel?: string | null;
  analysisFallbackModel?: string | null;
  scoreReaderEnabled?: boolean;
  scoreReaderProvider?: AiProvider;
  scoreReaderModel?: string | null;
  scoreReadMode?: ScoreReadMode;
  ocrLanguage?: string;
  timeoutMs?: number;
  maxImageBytes?: number;
}

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AiProviderRegistry,
  ) {}

  /// Dois upserts simultâneos na mesma linha estouram unique constraint no
  /// Postgres, então a leitura vem primeiro e o upsert só roda na criação.
  async row(): Promise<AiSettings> {
    const existing = await this.prisma.aiSettings.findUnique({ where: { id: 1 } });
    if (existing) return existing;
    return this.prisma.aiSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  }

  async analysis(preloaded?: AiSettings): Promise<AiFeatureConfig> {
    const settings = preloaded ?? (await this.row());
    return this.featureConfig(
      settings.analysisEnabled,
      settings.analysisProvider,
      settings.analysisModel,
      settings.analysisFallbackModel,
      false,
    );
  }

  async scoreReader(preloaded?: AiSettings) {
    const settings = preloaded ?? (await this.row());
    const needsVision = settings.scoreReadMode === ScoreReadMode.VISION;
    const feature = this.featureConfig(
      settings.scoreReaderEnabled,
      settings.scoreReaderProvider,
      settings.scoreReaderModel,
      null,
      needsVision,
    );

    return {
      ...feature,
      mode: settings.scoreReadMode,
      ocrLanguage: settings.ocrLanguage,
      timeoutMs: settings.timeoutMs,
      maxImageBytes: settings.maxImageBytes,
    };
  }

  async view() {
    const settings = await this.row();
    const [analysis, scoreReader] = await Promise.all([
      this.analysis(settings),
      this.scoreReader(settings),
    ]);

    return {
      providers: this.registry.catalog(),
      analysis: {
        enabled: settings.analysisEnabled,
        provider: settings.analysisProvider,
        model: settings.analysisModel,
        fallbackModel: settings.analysisFallbackModel,
        effectiveModel: analysis.provider?.model ?? null,
        ready: analysis.provider !== null,
        unavailableReason: analysis.unavailableReason,
      },
      scoreReader: {
        enabled: settings.scoreReaderEnabled,
        provider: settings.scoreReaderProvider,
        model: settings.scoreReaderModel,
        effectiveModel: scoreReader.provider?.model ?? null,
        mode: settings.scoreReadMode,
        ocrLanguage: settings.ocrLanguage,
        ready: scoreReader.provider !== null && !scoreReader.unavailableReason,
        unavailableReason: scoreReader.unavailableReason,
      },
      timeoutMs: settings.timeoutMs,
      maxImageBytes: settings.maxImageBytes,
      lastCheckedAt: settings.lastCheckedAt,
      lastCheckOk: settings.lastCheckOk,
      lastCheckMessage: settings.lastCheckMessage,
      updatedAt: settings.updatedAt,
    };
  }

  async update(input: UpdateAiSettingsInput, updatedByDiscordId: string) {
    await this.row();
    const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    await this.prisma.aiSettings.update({
      where: { id: 1 },
      data: { ...data, updatedByDiscordId },
    });
    return this.view();
  }

  async recordCheck(ok: boolean, message: string) {
    await this.prisma.aiSettings.update({
      where: { id: 1 },
      data: { lastCheckedAt: new Date(), lastCheckOk: ok, lastCheckMessage: message.slice(0, 300) },
    });
    return this.view();
  }

  private featureConfig(
    enabled: boolean,
    provider: AiProvider,
    model: string | null,
    fallbackModel: string | null,
    needsVision: boolean,
  ): AiFeatureConfig {
    if (!enabled) {
      return { enabled: false, provider: null, unavailableReason: 'Desligado no painel de administração.' };
    }

    const resolved = this.registry.resolve(provider, model, fallbackModel);
    if (!resolved) {
      const envKey = this.registry.catalog().find((item) => item.id === provider)?.envKey;
      return {
        enabled: true,
        provider: null,
        unavailableReason: `${provider} selecionado, mas ${envKey} não está definida nesta instância.`,
      };
    }
    if (needsVision && !resolved.supportsVision) {
      return {
        enabled: true,
        provider: null,
        unavailableReason: `${resolved.label} não lê imagens. Use o modo OCR ou troque de provedor.`,
      };
    }

    return { enabled: true, provider: resolved, unavailableReason: null };
  }
}
