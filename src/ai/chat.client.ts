import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ResolvedProvider } from './ai-provider.registry';

export interface ChatImage {
  base64: string;
  mimeType: string;
}

export interface ChatRequest {
  provider: ResolvedProvider;
  /// Provedor de outra empresa para tentar quando o primeiro falha de vez. Cair
  /// para outro modelo da mesma casa não ajuda: chave recusada, cota estourada e
  /// provedor fora do ar derrubam todos os modelos dela junto.
  fallbackProvider?: ResolvedProvider | null;
  system?: string;
  prompt: string;
  image?: ChatImage;
  json?: boolean;
  jsonSchema?: object;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  thinkingBudget?: number;
}

const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 65_000;

export const UNSUPPORTED_PARAMS = ['max_tokens', 'temperature'] as const;
export type UnsupportedParam = (typeof UNSUPPORTED_PARAMS)[number];

@Injectable()
export class ChatClient {
  private readonly logger = new Logger(ChatClient.name);
  private blockedUntil = 0;
  /// O que cada modelo já recusou, para não errar de novo na próxima chamada.
  private readonly quirks = new Map<string, Set<UnsupportedParam>>();

  async complete(request: ChatRequest): Promise<string> {
    try {
      return await this.callProvider(request, request.provider);
    } catch (error) {
      const fallback = request.fallbackProvider;
      if (!fallback || fallback.id === request.provider.id) throw error;

      this.logger.warn(
        `[AI] ${request.provider.label} falhou (${(error as Error).message}); tentando ${fallback.label}`,
      );
      return this.callProvider(request, fallback);
    }
  }

  private async callProvider(request: ChatRequest, provider: ResolvedProvider): Promise<string> {
    const timeoutMs = request.timeoutMs ?? 60_000;
    const model = provider.model;
    const call = { ...request, provider };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.waitForCooldown();

      try {
        return provider.wire === 'gemini'
          ? await this.callGemini(call, model, timeoutMs)
          : await this.callOpenAi(call, model, timeoutMs);
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        const code = (error as { code?: string })?.code;
        const transient =
          status === 408 ||
          status === 429 ||
          (typeof status === 'number' && status >= 500) ||
          code === 'ECONNABORTED' ||
          code === 'ETIMEDOUT';

        const delayMs =
          status === 429
            ? this.retryDelayFrom(error)
            : Math.min(8_000, 2 ** attempt * 1_000 + Math.floor(Math.random() * 500));

        if (!transient || attempt === MAX_RETRIES || delayMs > MAX_RETRY_DELAY_MS) throw new AiCallError(error);
        if (status === 429) this.blockedUntil = Date.now() + delayMs;

        this.logger.warn(`[AI] ${status ?? code ?? 'rede'}; nova tentativa em ${Math.ceil(delayMs / 1000)}s`);
        await wait(delayMs);
      }
    }

    throw new Error('Chamada de IA falhou');
  }

  private async callGemini(request: ChatRequest, model: string, timeoutMs: number): Promise<string> {
    const parts: Array<Record<string, unknown>> = [{ text: request.prompt }];
    if (request.image) {
      parts.push({ inlineData: { mimeType: request.image.mimeType, data: request.image.base64 } });
    }

    const response = await axios.post(
      `${request.provider.baseUrl}/models/${model}:generateContent`,
      {
        ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: request.temperature ?? 0.2,
          maxOutputTokens: request.maxTokens ?? 2048,
          ...(request.json ? { responseMimeType: 'application/json' } : {}),
          ...(request.jsonSchema ? { responseSchema: request.jsonSchema } : {}),
          ...(request.thinkingBudget ? { thinkingConfig: { thinkingBudget: request.thinkingBudget } } : {}),
        },
      },
      {
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': request.provider.apiKey },
        timeout: timeoutMs,
      },
    );

    const candidate = response.data?.candidates?.[0];
    return (candidate?.content?.parts ?? [])
      .map((part: { text?: string }) => part?.text ?? '')
      .join('');
  }

  /// Modelo de raciocínio recusa `max_tokens` e `temperature`, e cada casa lança
  /// modelo novo do jeito dela. Em vez de adivinhar pelo nome, deixamos o
  /// provedor dizer: ele recusa uma vez, guardamos a manha daquele modelo e a
  /// chamada é refeita. Da segunda vez em diante já sai certa.
  private async callOpenAi(request: ChatRequest, model: string, timeoutMs: number): Promise<string> {
    /// Uma volta por parâmetro conhecido: o modelo que recusa os dois aprende os
    /// dois nesta mesma chamada, em vez de falhar uma vez para cada.
    for (let attempt = 0; attempt <= UNSUPPORTED_PARAMS.length; attempt++) {
      try {
        return await this.postOpenAi(request, model, timeoutMs);
      } catch (error) {
        const param = unsupportedParamFrom(error);
        if (!param || this.quirksOf(model).has(param)) throw error;

        this.quirksOf(model).add(param);
        this.logger.warn(`[AI] ${model} não aceita ${param}; refazendo a chamada sem ele`);
      }
    }

    throw new Error(`Chamada de IA falhou: ${model} recusou o corpo montado`);
  }

  private quirksOf(model: string): Set<UnsupportedParam> {
    const known = this.quirks.get(model);
    if (known) return known;
    const fresh = new Set<UnsupportedParam>();
    this.quirks.set(model, fresh);
    return fresh;
  }

  private async postOpenAi(request: ChatRequest, model: string, timeoutMs: number): Promise<string> {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: request.prompt }];
    if (request.image) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${request.image.mimeType};base64,${request.image.base64}` },
      });
    }

    const quirks = this.quirksOf(model);
    const maxTokens = request.maxTokens ?? 2048;

    const response = await axios.post(
      `${request.provider.baseUrl}/chat/completions`,
      {
        model,
        messages: [
          ...(request.system ? [{ role: 'system', content: request.system }] : []),
          { role: 'user', content: request.image ? content : request.prompt },
        ],
        ...(quirks.has('temperature') ? {} : { temperature: request.temperature ?? 0.2 }),
        ...(quirks.has('max_tokens')
          ? { max_completion_tokens: maxTokens }
          : { max_tokens: maxTokens }),
        ...(request.json ? { response_format: { type: 'json_object' } } : {}),
      },
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.provider.apiKey}` },
        timeout: timeoutMs,
      },
    );

    const message = response.data?.choices?.[0]?.message?.content;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.map((part: { text?: string }) => part?.text ?? '').join('');
    return '';
  }

  private async waitForCooldown() {
    const remaining = this.blockedUntil - Date.now();
    if (remaining <= 0) return;
    if (remaining > MAX_RETRY_DELAY_MS) throw new Error(`IA em espera por ${Math.ceil(remaining / 1000)}s`);
    await wait(remaining);
  }

  private retryDelayFrom(error: unknown): number {
    const data = errorData(error);
    const retryDelay = data?.error?.details?.find((detail: { '@type'?: string }) =>
      detail?.['@type']?.includes('RetryInfo'),
    )?.retryDelay;
    const parsed = typeof retryDelay === 'string' ? Number(retryDelay.replace('s', '')) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed * 1000);

    const header = (error as { response?: { headers?: Record<string, unknown> } })?.response?.headers?.[
      'retry-after'
    ];
    const seconds = Number(Array.isArray(header) ? header[0] : header);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
  }
}

/// Lê a recusa do provedor: qual parâmetro do corpo ele não aceita neste modelo.
/// Só reage a 400, porque 401 e 429 falam de chave e de cota, não de formato.
export function unsupportedParamFrom(error: unknown): UnsupportedParam | null {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status !== 400) return null;

  const message = describeAiError(error).toLowerCase();
  if (message.includes('max_completion_tokens')) return 'max_tokens';
  if (message.includes('temperature')) return 'temperature';
  return null;
}

/// O erro do axios carrega a requisição inteira, e nela vai o header
/// Authorization com a chave do provedor. Nada disso pode sair daqui: quem
/// receber esta exceção só vê status e mensagem, então nem o log do Nest nem
/// uma resposta de erro conseguem vazar a chave.
export class AiCallError extends Error {
  readonly status?: number;

  constructor(cause: unknown) {
    super(describeAiError(cause));
    this.name = 'AiCallError';
    this.status = (cause as { response?: { status?: number } })?.response?.status;
  }
}

/// O modelo às vezes embrulha o JSON em cerca de código ou fala antes dele, mesmo
/// com json: true. Aqui a resposta vira objeto ou vira null, sem estourar.
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const candidate = cleaned.startsWith('{') ? cleaned : cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1);
  if (!candidate) return null;

  try {
    const parsed: unknown = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function describeAiError(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  const data = errorData(error);
  const message = String(data?.error?.message ?? data?.message ?? (error as Error)?.message ?? 'erro desconhecido');
  return `${status ? `HTTP ${status}: ` : ''}${message.replace(/\s+/g, ' ').slice(0, 240)}`;
}

function errorData(error: unknown): any {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return { error: { message: data } };
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
