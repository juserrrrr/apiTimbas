import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ScoreReadMode } from '@prisma/client';
import { AiSettingsService } from '../ai/ai-settings.service';
import { ChatClient, describeAiError, parseJsonObject } from '../ai/chat.client';
import { LocalOcrService } from '../score-reader/local-ocr.service';
import { normalizePosition } from './position.mapper';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export interface ExtractedPlayer {
  name: string;
  position: string;
  overall: number | null;
  nationality: string | null;
}

export interface SquadExtraction {
  teamName: string | null;
  players: ExtractedPlayer[];
  notes: string;
  provider: string | null;
  model: string | null;
}

export interface ExtractedTeam {
  name: string;
  shortName: string | null;
}

export interface TeamExtraction {
  teams: ExtractedTeam[];
  notes: string;
  provider: string | null;
  model: string | null;
}

const SYSTEM_PROMPT =
  'Você transcreve listas de elenco de futebol a partir de capturas de tela. Responda somente com JSON válido. Nunca invente jogadores que não estejam visíveis.';

@Injectable()
export class SquadVisionService {
  private readonly logger = new Logger(SquadVisionService.name);

  constructor(
    private readonly settings: AiSettingsService,
    private readonly chat: ChatClient,
    private readonly ocr: LocalOcrService,
  ) {}

  async extract(imageBase64: string, mimeType: string, hintTeamName?: string): Promise<SquadExtraction> {
    const config = await this.requireProvider();
    const payload = this.decode(imageBase64, mimeType);
    const useOcr = config.mode === ScoreReadMode.OCR_TEXT;
    let extractedText = '';

    if (useOcr) {
      extractedText = await this.ocr.read(payload.base64, payload.mimeType, config.ocrLanguage);
      if (!extractedText) throw new BadRequestException('O OCR não encontrou texto nesta imagem.');
    }

    try {
      const answer = await this.chat.complete({
        provider: config.provider,
        system: SYSTEM_PROMPT,
        prompt: buildSquadPrompt(hintTeamName, extractedText),
        image: useOcr ? undefined : { base64: payload.base64, mimeType: payload.mimeType },
        json: true,
        maxTokens: 4096,
        timeoutMs: config.timeoutMs,
      });

      const parsed = parseSquad(answer);
      if (!parsed) throw new BadRequestException('O modelo respondeu num formato que não pôde ser lido.');

      return {
        ...parsed,
        provider: config.provider.id,
        model: config.provider.model,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const message = describeAiError(error);
      this.logger.warn(`Falha ao extrair elenco da imagem: ${message}`);
      throw new BadRequestException(`Não foi possível ler a imagem: ${message}`);
    }
  }

  async extractFromText(text: string, hintTeamName?: string): Promise<SquadExtraction> {
    const config = await this.requireProvider();
    const answer = await this.chat.complete({
      provider: config.provider!,
      system: SYSTEM_PROMPT,
      prompt: buildSquadPrompt(hintTeamName, text),
      json: true,
      maxTokens: 4096,
      timeoutMs: config.timeoutMs,
    });

    const parsed = parseSquad(answer);
    if (!parsed) throw new BadRequestException('O modelo respondeu num formato que não pôde ser lido.');
    return { ...parsed, provider: config.provider!.id, model: config.provider!.model };
  }

  async extractTeams(input: { imageBase64?: string; mimeType?: string; text?: string }): Promise<TeamExtraction> {
    const config = await this.requireProvider();
    let source = input.text?.trim() ?? '';
    let image: { base64: string; mimeType: string } | undefined;

    if (input.imageBase64 && input.mimeType) {
      const payload = this.decode(input.imageBase64, input.mimeType);
      if (config.mode === ScoreReadMode.OCR_TEXT) {
        source = await this.ocr.read(payload.base64, payload.mimeType, config.ocrLanguage);
        if (!source) throw new BadRequestException('O OCR não encontrou texto nesta imagem.');
      } else {
        image = { base64: payload.base64, mimeType: payload.mimeType };
      }
    }

    if (!source && !image) throw new BadRequestException('Envie uma imagem ou cole o texto com a lista de times.');

    try {
      const answer = await this.chat.complete({
        provider: config.provider!,
        system:
          'Você transcreve listas de times de futebol. Responda somente com JSON válido. Nunca invente times que não estejam na fonte.',
        prompt: buildTeamsPrompt(source),
        image,
        json: true,
        maxTokens: 2048,
        timeoutMs: config.timeoutMs,
      });

      const parsed = parseTeams(answer);
      if (!parsed) throw new BadRequestException('O modelo respondeu num formato que não pôde ser lido.');
      return { ...parsed, provider: config.provider!.id, model: config.provider!.model };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const message = describeAiError(error);
      this.logger.warn(`Falha ao extrair times: ${message}`);
      throw new BadRequestException(`Não foi possível ler a lista: ${message}`);
    }
  }

  private async requireProvider() {
    const config = await this.settings.scoreReader();
    if (!config.provider || config.unavailableReason) {
      throw new BadRequestException(
        config.unavailableReason ?? 'Leitura por IA indisponível. Configure a IA no painel de administração.',
      );
    }
    return config;
  }

  private decode(imageBase64: string, mimeType: string) {
    const resolved = mimeType.toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(resolved)) {
      throw new BadRequestException('Formato de imagem não suportado. Use JPEG, PNG ou WebP.');
    }
    const base64 = imageBase64.includes(',') ? imageBase64.slice(imageBase64.indexOf(',') + 1) : imageBase64;
    const bytes = Math.floor((base64.length * 3) / 4);
    if (bytes === 0) throw new BadRequestException('Imagem inválida.');
    if (bytes > MAX_IMAGE_BYTES) throw new BadRequestException('A imagem precisa ter no máximo 4MB.');
    return { base64, mimeType: resolved };
  }
}

function buildSquadPrompt(hintTeamName: string | undefined, extractedText: string): string {
  const source = extractedText
    ? `TEXTO EXTRAÍDO POR OCR:\n"""\n${extractedText.slice(0, 12000)}\n"""`
    : 'A imagem com a lista de jogadores está anexada nesta mensagem.';

  return `${source}

${hintTeamName ? `O time esperado é "${hintTeamName}".` : 'Identifique o time se ele aparecer na imagem.'}

Transcreva TODOS os jogadores visíveis, na ordem em que aparecem, e responda neste formato:
{
  "teamName": "nome do time ou null",
  "players": [
    { "name": "nome do jogador", "position": "posição como aparece", "overall": 0, "nationality": "país ou null" }
  ],
  "notes": "o que ficou ilegível ou duvidoso (máx 200 caracteres)"
}

Regras:
- Copie os nomes exatamente como aparecem, sem corrigir nem completar.
- overall é um inteiro de 1 a 99 se a imagem mostrar uma nota; use null se não houver.
- Se a posição não aparecer, use null.
- Não repita jogadores e não invente nenhum que não esteja visível.
- Se a imagem não for uma lista de elenco, devolva players como lista vazia e explique em notes.`;
}

function parseSquad(text: string): { teamName: string | null; players: ExtractedPlayer[]; notes: string } | null {
  const parsed = parseJsonObject(text);
  if (!parsed || !Array.isArray(parsed.players)) return null;

  const seen = new Set<string>();
  const players = (parsed.players as Array<Record<string, unknown>>)
    .map((player) => {
      const name = typeof player?.name === 'string' ? player.name.trim() : '';
      const overall = Math.round(Number(player?.overall));
      return {
        name,
        position: normalizePosition(typeof player?.position === 'string' ? player.position : null),
        overall: Number.isFinite(overall) && overall >= 1 && overall <= 99 ? overall : null,
        nationality: typeof player?.nationality === 'string' ? player.nationality.trim() || null : null,
      };
    })
    .filter((player) => {
      if (player.name.length < 2) return false;
      const key = player.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    teamName: typeof parsed.teamName === 'string' ? parsed.teamName.trim() || null : null,
    players,
    notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 240) : '',
  };
}

function buildTeamsPrompt(source: string): string {
  const block = source
    ? `LISTA RECEBIDA:
\"\"\"
${source.slice(0, 12000)}
\"\"\"`
    : 'A imagem com a lista de times está anexada nesta mensagem.';

  return `${block}

Transcreva todos os times, na ordem em que aparecem, e responda neste formato:
{
  "teams": [{ "name": "nome do time", "shortName": "sigla de até 4 letras ou null" }],
  "notes": "o que ficou ilegível ou duvidoso (máx 200 caracteres)"
}

Regras:
- Copie os nomes como aparecem, sem abreviar nem completar.
- Não repita times e não invente nenhum que não esteja na fonte.
- Se não for uma lista de times, devolva teams vazio e explique em notes.`;
}

function parseTeams(text: string): { teams: ExtractedTeam[]; notes: string } | null {
  const parsed = parseJsonObject(text);
  if (!parsed || !Array.isArray(parsed.teams)) return null;

  const seen = new Set<string>();
  const teams = (parsed.teams as Array<Record<string, unknown>>)
    .map((team) => ({
      name: typeof team?.name === 'string' ? team.name.trim() : '',
      shortName:
        typeof team?.shortName === 'string' && team.shortName.trim()
          ? team.shortName.trim().slice(0, 8).toUpperCase()
          : null,
    }))
    .filter((team) => {
      if (team.name.length < 2) return false;
      const key = team.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return { teams, notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 240) : '' };
}
