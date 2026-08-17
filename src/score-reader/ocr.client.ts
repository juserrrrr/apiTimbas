import axios from 'axios';

export interface OcrRequest {
  baseUrl: string;
  apiKey: string | null;
  engine: string;
  timeoutMs: number;
  imageBase64: string;
  mimeType: string;
}

export async function extractText(request: OcrRequest): Promise<string> {
  const text =
    request.engine === 'ocr.space'
      ? await callOcrSpace(request)
      : await callGenericOcr(request);
  return text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function callOcrSpace(request: OcrRequest): Promise<string> {
  const form = new URLSearchParams({
    base64Image: `data:${request.mimeType};base64,${request.imageBase64}`,
    language: 'por',
    scale: 'true',
    OCREngine: '2',
    isTable: 'true',
  });

  const response = await axios.post(request.baseUrl, form.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(request.apiKey ? { apikey: request.apiKey } : {}),
    },
    timeout: request.timeoutMs,
  });

  if (response.data?.IsErroredOnProcessing) {
    const detail = Array.isArray(response.data?.ErrorMessage)
      ? response.data.ErrorMessage.join(' ')
      : String(response.data?.ErrorMessage ?? 'falha no OCR');
    throw new Error(detail);
  }

  const results = response.data?.ParsedResults;
  if (!Array.isArray(results)) throw new Error('Resposta do OCR sem ParsedResults.');
  return results.map((result: { ParsedText?: string }) => result?.ParsedText ?? '').join('\n');
}

async function callGenericOcr(request: OcrRequest): Promise<string> {
  const response = await axios.post(
    request.baseUrl,
    { image: request.imageBase64, mimeType: request.mimeType },
    {
      headers: {
        'Content-Type': 'application/json',
        ...(request.apiKey ? { Authorization: `Bearer ${request.apiKey}` } : {}),
      },
      timeout: request.timeoutMs,
    },
  );

  const text = response.data?.text ?? response.data?.result ?? response.data?.data?.text;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Resposta do OCR sem campo "text".');
  return text;
}
