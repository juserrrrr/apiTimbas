import { Injectable } from '@nestjs/common';
import { AiProvider } from '@prisma/client';

export interface AiProviderDefinition {
  id: AiProvider;
  label: string;
  envKey: string;
  baseUrl: string;
  defaultModel: string;
  defaultFallbackModel: string;
  supportsVision: boolean;
  wire: 'gemini' | 'openai';
  docsUrl: string;
}

export interface ResolvedProvider extends AiProviderDefinition {
  apiKey: string;
  model: string;
  fallbackModel: string;
}

export const AI_PROVIDERS: Record<AiProvider, AiProviderDefinition> = {
  GEMINI: {
    id: 'GEMINI',
    label: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    defaultFallbackModel: 'gemini-2.5-flash-lite',
    supportsVision: true,
    wire: 'gemini',
    docsUrl: 'https://aistudio.google.com/apikey',
  },
  DEEPSEEK: {
    id: 'DEEPSEEK',
    label: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    defaultFallbackModel: 'deepseek-chat',
    supportsVision: false,
    wire: 'openai',
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
  OPENAI: {
    id: 'OPENAI',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    defaultFallbackModel: 'gpt-4o-mini',
    supportsVision: true,
    wire: 'openai',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
};

@Injectable()
export class AiProviderRegistry {
  apiKeyOf(provider: AiProvider): string | null {
    const key = process.env[AI_PROVIDERS[provider].envKey];
    return key && key.trim() ? key.trim() : null;
  }

  isConfigured(provider: AiProvider): boolean {
    return this.apiKeyOf(provider) !== null;
  }

  resolve(provider: AiProvider, model?: string | null, fallbackModel?: string | null): ResolvedProvider | null {
    const apiKey = this.apiKeyOf(provider);
    if (!apiKey) return null;
    const definition = AI_PROVIDERS[provider];
    return {
      ...definition,
      apiKey,
      model: model?.trim() || definition.defaultModel,
      fallbackModel: fallbackModel?.trim() || definition.defaultFallbackModel,
    };
  }

  /// O painel admin lista os provedores sem nunca expor a chave: só diz se a
  /// variável de ambiente correspondente existe nesta instância.
  catalog() {
    return Object.values(AI_PROVIDERS).map((definition) => ({
      id: definition.id,
      label: definition.label,
      envKey: definition.envKey,
      defaultModel: definition.defaultModel,
      defaultFallbackModel: definition.defaultFallbackModel,
      supportsVision: definition.supportsVision,
      docsUrl: definition.docsUrl,
      configured: this.isConfigured(definition.id),
    }));
  }
}
