import { Injectable } from '@nestjs/common';
import { AiProvider } from '@prisma/client';

export interface AiProviderDefinition {
  id: AiProvider;
  label: string;
  envKey: string;
  baseUrl: string;
  defaultModel: string;
  /// Modelos que o painel oferece no select. O campo continua livre: isto é
  /// atalho, não trava. Só entram modelos comuns, porque os de raciocínio não
  /// aceitam o corpo que o ChatClient monta.
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
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
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
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
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
