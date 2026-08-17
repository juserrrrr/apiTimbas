import { Injectable, Logger } from '@nestjs/common';
import { ScoreReaderProvider } from '@prisma/client';
import { describeHttpError, requestChatCompletion } from './chat-completions.client';
import { extractText } from './ocr.client';
import { ResolvedScoreReaderConfig, ScoreReaderConfigService } from './score-reader-config.service';
import {
  DetectedScoreboard,
  ScoreReadRequest,
  ScoreReading,
  UNAVAILABLE_READING,
} from './score-reader.types';
import { SCOREBOARD_SYSTEM_PROMPT, buildScoreboardPrompt, parseScoreboard } from './scoreboard.prompt';

const NAME_MATCH_THRESHOLD = 0.45;

@Injectable()
export class ScoreReaderService {
  private readonly logger = new Logger(ScoreReaderService.name);

  constructor(private readonly config: ScoreReaderConfigService) {}

  async read(request: ScoreReadRequest): Promise<ScoreReading> {
    const config = await this.config.load();
    const unavailable = this.rejectionReason(config, request);
    if (unavailable) return { ...UNAVAILABLE_READING, notes: unavailable };

    try {
      const detected =
        config.provider === ScoreReaderProvider.OCR_TEXT
          ? await this.readWithOcr(config, request)
          : await this.readWithVision(config, request);

      if (!detected) {
        return {
          available: true,
          provider: config.provider,
          model: config.model,
          homeScore: null,
          awayScore: null,
          confidence: 0,
          notes: 'O modelo respondeu num formato que não pôde ser lido. Aprovação manual necessária.',
          raw: null,
        };
      }

      const oriented = this.orient(detected, request.homeName, request.awayName);
      return {
        available: true,
        provider: config.provider,
        model: config.model,
        homeScore: oriented.homeScore,
        awayScore: oriented.awayScore,
        confidence: oriented.confidence,
        notes: oriented.notes,
        raw: detected as unknown,
      };
    } catch (error) {
      const message = describeHttpError(error);
      this.logger.warn(`Falha na leitura do placar: ${message}`);
      return {
        available: false,
        provider: config.provider,
        model: config.model,
        homeScore: null,
        awayScore: null,
        confidence: 0,
        notes: `Leitura automática indisponível (${message}). A prova segue para aprovação manual.`,
        raw: null,
      };
    }
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    const config = await this.config.load();
    if (!config.apiKey) return this.finishTest(false, 'Nenhuma chave de API configurada.');
    if (config.provider === ScoreReaderProvider.OCR_TEXT && !config.ocrBaseUrl) {
      return this.finishTest(false, 'Provider OCR_TEXT selecionado, mas sem URL de OCR.');
    }

    try {
      const answer = await requestChatCompletion({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        timeoutMs: config.timeoutMs,
        messages: [
          { role: 'system', content: 'Responda apenas com JSON válido.' },
          { role: 'user', content: 'Responda exatamente {"ok":true}.' },
        ],
      });
      if (!answer.includes('"ok"')) {
        return this.finishTest(false, `Modelo ${config.model} respondeu fora do formato esperado.`);
      }
      const ocrNote =
        config.provider === ScoreReaderProvider.OCR_TEXT ? ` OCR apontado para ${config.ocrBaseUrl}.` : '';
      return this.finishTest(true, `Conexão com ${config.model} em ${config.baseUrl} funcionando.${ocrNote}`);
    } catch (error) {
      return this.finishTest(false, describeHttpError(error));
    }
  }

  private async finishTest(ok: boolean, message: string) {
    await this.config.recordCheck(ok, message);
    return { ok, message };
  }

  private rejectionReason(config: ResolvedScoreReaderConfig, request: ScoreReadRequest): string | null {
    if (!config.enabled) return UNAVAILABLE_READING.notes;
    if (!config.apiKey) return 'Leitura automática sem chave de API configurada — aprovação manual necessária.';
    if (config.provider === ScoreReaderProvider.OCR_TEXT && !config.ocrBaseUrl) {
      return 'Leitura automática sem OCR configurado — aprovação manual necessária.';
    }
    const bytes = Math.floor((request.imageBase64.length * 3) / 4);
    if (bytes > config.maxImageBytes) {
      return `Imagem de ${Math.round(bytes / 1024)}KB acima do limite de leitura automática — aprovação manual necessária.`;
    }
    return null;
  }

  private async readWithVision(
    config: ResolvedScoreReaderConfig,
    request: ScoreReadRequest,
  ): Promise<DetectedScoreboard | null> {
    const answer = await requestChatCompletion({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey!,
      model: config.model,
      timeoutMs: config.timeoutMs,
      messages: [
        { role: 'system', content: SCOREBOARD_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildScoreboardPrompt(request) },
            {
              type: 'image_url',
              image_url: { url: `data:${request.mimeType};base64,${request.imageBase64}` },
            },
          ],
        },
      ],
    });
    return parseScoreboard(answer);
  }

  private async readWithOcr(
    config: ResolvedScoreReaderConfig,
    request: ScoreReadRequest,
  ): Promise<DetectedScoreboard | null> {
    const extractedText = await extractText({
      baseUrl: config.ocrBaseUrl!,
      apiKey: config.ocrApiKey,
      engine: config.ocrEngine,
      timeoutMs: config.timeoutMs,
      imageBase64: request.imageBase64,
      mimeType: request.mimeType,
    });

    if (!extractedText) {
      return { leftTeam: '', leftScore: 0, rightTeam: '', rightScore: 0, confidence: 0, notes: 'OCR não encontrou texto na imagem.' };
    }

    const answer = await requestChatCompletion({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey!,
      model: config.model,
      timeoutMs: config.timeoutMs,
      messages: [
        { role: 'system', content: SCOREBOARD_SYSTEM_PROMPT },
        { role: 'user', content: buildScoreboardPrompt({ ...request, extractedText }) },
      ],
    });
    return parseScoreboard(answer);
  }

  private orient(detected: DetectedScoreboard, homeName: string, awayName: string) {
    const direct = similarity(detected.leftTeam, homeName) + similarity(detected.rightTeam, awayName);
    const swapped = similarity(detected.leftTeam, awayName) + similarity(detected.rightTeam, homeName);
    const best = Math.max(direct, swapped);

    if (best < NAME_MATCH_THRESHOLD) {
      return {
        homeScore: detected.leftScore,
        awayScore: detected.rightScore,
        confidence: Math.min(detected.confidence, 40),
        notes: `Não deu para casar os nomes do placar ("${detected.leftTeam}" x "${detected.rightTeam}") com ${homeName} x ${awayName}. ${detected.notes}`.trim(),
      };
    }

    const isSwapped = swapped > direct;
    return {
      homeScore: isSwapped ? detected.rightScore : detected.leftScore,
      awayScore: isSwapped ? detected.leftScore : detected.rightScore,
      confidence: detected.confidence,
      notes: detected.notes,
    };
  }
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.8;

  const leftTokens = new Set(left.split(' '));
  const rightTokens = right.split(' ');
  const shared = rightTokens.filter((token) => token.length > 2 && leftTokens.has(token)).length;
  return shared / Math.max(leftTokens.size, rightTokens.length);
}
