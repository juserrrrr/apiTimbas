import axios from 'axios';

export interface ChatMessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string | ChatMessageContent[];
}

export interface ChatCompletionOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  messages: ChatMessage[];
}

export async function requestChatCompletion(options: ChatCompletionOptions): Promise<string> {
  const response = await axios.post(
    `${options.baseUrl}/chat/completions`,
    {
      model: options.model,
      messages: options.messages,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      timeout: options.timeoutMs,
    },
  );

  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part: ChatMessageContent) => part?.text ?? '').join('');
  }
  return '';
}

export function describeHttpError(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  const apiMessage =
    typeof data === 'object' && data !== null
      ? ((data as { error?: { message?: string }; message?: string }).error?.message ??
        (data as { message?: string }).message)
      : undefined;
  const message = apiMessage ?? (error as Error)?.message ?? 'erro desconhecido';
  return `${status ? `HTTP ${status}: ` : ''}${String(message).replace(/\s+/g, ' ').slice(0, 240)}`;
}
