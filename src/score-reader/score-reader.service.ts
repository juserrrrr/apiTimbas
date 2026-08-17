import { Injectable, Logger } from '@nestjs/common';
import { ScoreReadMode } from '@prisma/client';
import { AiSettingsService } from '../ai/ai-settings.service';
import { ChatClient, describeAiError } from '../ai/chat.client';
import { LocalOcrService } from './local-ocr.service';
import { DetectedScoreboard, ScoreReadRequest, ScoreReading, UNAVAILABLE_READING } from './score-reader.types';
import { SCOREBOARD_SYSTEM_PROMPT, buildScoreboardPrompt, parseScoreboard } from './scoreboard.prompt';

const NAME_MATCH_THRESHOLD = 0.45;

@Injectable()
export class ScoreReaderService {
  private readonly logger = new Logger(ScoreReaderService.name);

  constructor(
    private readonly settings: AiSettingsService,
    private readonly chat: ChatClient,
    private readonly ocr: LocalOcrService,
  ) {}

  async read(request: ScoreReadRequest): Promise<ScoreReading> {
    const config = await this.settings.scoreReader();

    if (!config.provider || config.unavailableReason) {
      return { ...UNAVAILABLE_READING, notes: config.unavailableReason ?? UNAVAILABLE_READING.notes };
    }

    const bytes = Math.floor((request.imageBase64.length * 3) / 4);
    if (bytes > config.maxImageBytes) {
      return {
        ...UNAVAILABLE_READING,
        notes: `Imagem de ${Math.round(bytes / 1024)}KB acima do limite da leitura automática, então a prova vai para aprovação manual.`,
      };
    }

    try {
      const detected =
        config.mode === ScoreReadMode.OCR_TEXT
          ? await this.readWithOcr(config, request)
          : await this.readWithVision(config, request);

      if (!detected) {
        return {
          available: true,
          provider: config.provider.id,
          model: config.provider.model,
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
        provider: config.provider.id,
        model: config.provider.model,
        homeScore: oriented.homeScore,
        awayScore: oriented.awayScore,
        confidence: oriented.confidence,
        notes: oriented.notes,
        raw: detected as unknown,
      };
    } catch (error) {
      const message = describeAiError(error);
      this.logger.warn(`Falha na leitura do placar: ${message}`);
      return {
        available: false,
        provider: config.provider.id,
        model: config.provider.model,
        homeScore: null,
        awayScore: null,
        confidence: 0,
        notes: `Leitura automática indisponível (${message}). A prova segue para aprovação manual.`,
        raw: null,
      };
    }
  }

  private async readWithVision(
    config: Awaited<ReturnType<AiSettingsService['scoreReader']>>,
    request: ScoreReadRequest,
  ): Promise<DetectedScoreboard | null> {
    const answer = await this.chat.complete({
      provider: config.provider!,
      system: SCOREBOARD_SYSTEM_PROMPT,
      prompt: buildScoreboardPrompt(request),
      image: { base64: request.imageBase64, mimeType: request.mimeType },
      json: true,
      maxTokens: 400,
      timeoutMs: config.timeoutMs,
    });
    return parseScoreboard(answer);
  }

  private async readWithOcr(
    config: Awaited<ReturnType<AiSettingsService['scoreReader']>>,
    request: ScoreReadRequest,
  ): Promise<DetectedScoreboard | null> {
    const extractedText = await this.ocr.read(request.imageBase64, request.mimeType, config.ocrLanguage);

    if (!extractedText) {
      return {
        leftTeam: '',
        leftScore: 0,
        rightTeam: '',
        rightScore: 0,
        confidence: 0,
        notes: 'OCR não encontrou texto na imagem.',
      };
    }

    const answer = await this.chat.complete({
      provider: config.provider!,
      system: SCOREBOARD_SYSTEM_PROMPT,
      prompt: buildScoreboardPrompt({ ...request, extractedText }),
      json: true,
      maxTokens: 400,
      timeoutMs: config.timeoutMs,
    });
    return parseScoreboard(answer);
  }

  private orient(detected: DetectedScoreboard, homeName: string, awayName: string) {
    const direct = similarity(detected.leftTeam, homeName) + similarity(detected.rightTeam, awayName);
    const swapped = similarity(detected.leftTeam, awayName) + similarity(detected.rightTeam, homeName);

    if (Math.max(direct, swapped) < NAME_MATCH_THRESHOLD) {
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
