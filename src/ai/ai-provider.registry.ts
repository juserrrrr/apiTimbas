import { Injectable } from '@nestjs/common';
import { AiProvider } from '@prisma/client';

export interface AiProviderDefinition {
  id: AiProvider;
  label: string;
  envKey: string;
  baseUrl: string;
  defaultModel: string;
  /// Modelos que o painel oferece no select, do mais novo para o mais barato.
  /// O campo continua livre, porque provedor lança modelo toda semana e esta
  /// lista envelhece: ela é atalho, não trava.
  models: string[];
  supportsVision: boolean;
  wire: 'gemini' | 'openai';
  docsUrl: string;
}

export interface ResolvedProvider extends AiProviderDefinition {
  apiKey: string;
  model: string;
}

export const AI_PROVIDERS: Record<AiProvider, AiProviderDefinition> = {
  GEMINI: {
    id: 'GEMINI',
    label: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.7-flash',
    models: [
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro',
    ],
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
    models: ['deepseek-chat'],
    supportsVision: false,
    wire: 'openai',
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
  OPENAI: {
    id: 'OPENAI',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.6-luna',
    models: ['gpt-5.6', 'gpt-5.6-terra', 'gpt-5.6-luna'],
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

  resolve(provider: AiProvider, model?: string | null): ResolvedProvider | null {
    const apiKey = this.apiKeyOf(provider);
    if (!apiKey) return null;
    const definition = AI_PROVIDERS[provider];
    return {
      ...definition,
      apiKey,
      model: model?.trim() || definition.defaultModel,
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
      models: definition.models,
      supportsVision: definition.supportsVision,
      docsUrl: definition.docsUrl,
      configured: this.isConfigured(definition.id),
    }));
  }
}
