import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ResolvedProvider } from './ai-provider.registry';

export interface ChatImage {
  base64: string;
  mimeType: string;
}

export interface ChatRequest {
  provider: ResolvedProvider;
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

@Injectable()
export class ChatClient {
  private readonly logger = new Logger(ChatClient.name);
  private blockedUntil = 0;

  async complete(request: ChatRequest): Promise<string> {
    const timeoutMs = request.timeoutMs ?? 60_000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const useFallback = attempt === MAX_RETRIES && request.provider.fallbackModel !== request.provider.model;
      const model = useFallback ? request.provider.fallbackModel : request.provider.model;
      if (useFallback) this.logger.warn(`[AI] usando modelo reserva ${model}`);

      await this.waitForCooldown();

      try {
        return request.provider.wire === 'gemini'
          ? await this.callGemini(request, model, timeoutMs)
          : await this.callOpenAi(request, model, timeoutMs);
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

        if (!transient || attempt === MAX_RETRIES || delayMs > MAX_RETRY_DELAY_MS) throw error;
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

  private async callOpenAi(request: ChatRequest, model: string, timeoutMs: number): Promise<string> {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: request.prompt }];
    if (request.image) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${request.image.mimeType};base64,${request.image.base64}` },
      });
    }

    const response = await axios.post(
      `${request.provider.baseUrl}/chat/completions`,
      {
        model,
        messages: [
          ...(request.system ? [{ role: 'system', content: request.system }] : []),
          { role: 'user', content: request.image ? content : request.prompt },
        ],
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 2048,
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
