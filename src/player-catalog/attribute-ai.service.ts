import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiSettingsService } from '../ai/ai-settings.service';
import { ChatClient, describeAiError } from '../ai/chat.client';
import { ATTRIBUTE_KEYS, PlayerAttributes, clampAttribute, overallFromAttributes } from '../football/attributes';

export interface PlayerToEstimate {
  name: string;
  position: string;
  realTeam: string;
  nationality: string | null;
  birthDate: Date | null;
  competition: string | null;
}

export interface EstimatedPlayer {
  name: string;
  attributes: PlayerAttributes;
  overall: number;
  confidence: number;
  note: string;
}

export interface AttributeEstimation {
  players: EstimatedPlayer[];
  model: string;
}

const BATCH_SIZE = 12;

const SYSTEM_PROMPT =
  'Você é um scout de futebol que traduz o nível real de um jogador para os atributos do card do EA FC. Responda somente com JSON válido. Nunca use travessão nos textos.';

@Injectable()
export class AttributeAiService {
  private readonly logger = new Logger(AttributeAiService.name);

  constructor(
    private readonly settings: AiSettingsService,
    private readonly chat: ChatClient,
  ) {}

  async estimate(players: PlayerToEstimate[]): Promise<AttributeEstimation> {
    const { provider, unavailableReason } = await this.settings.analysis();
    if (!provider) {
      throw new BadRequestException(
        unavailableReason ?? 'IA indisponível. Configure o provedor no painel de administração.',
      );
    }

    const estimated: EstimatedPlayer[] = [];
    for (let start = 0; start < players.length; start += BATCH_SIZE) {
      const batch = players.slice(start, start + BATCH_SIZE);
      try {
        const answer = await this.chat.complete({
          provider,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(batch),
          json: true,
          maxTokens: 3072,
        });
        estimated.push(...parseEstimation(answer, batch));
      } catch (error) {
        this.logger.warn(`Falha ao estimar atributos: ${describeAiError(error)}`);
        if (estimated.length === 0) {
          throw new BadRequestException(`Não foi possível estimar os atributos: ${describeAiError(error)}`);
        }
      }
    }

    return { players: estimated, model: provider.model };
  }
}

function buildPrompt(players: PlayerToEstimate[]): string {
  const rows = players.map((player) => ({
    nome: player.name,
    posicao: player.position,
    time: player.realTeam,
    nacionalidade: player.nationality,
    nascimento: player.birthDate ? player.birthDate.toISOString().slice(0, 10) : null,
    competicao: player.competition,
  }));

  return `Estime os atributos de cada jogador da lista, na escala de 1 a 99 do EA FC.

JOGADORES:
${JSON.stringify(rows, null, 2)}

Para jogador de linha os atributos são ritmo (pace), finalização (shooting), passe (passing), drible (dribbling), defesa (defending) e físico (physical).
Para goleiro as mesmas chaves valem, na ordem: pace = elasticidade, shooting = manejo, passing = chute, dribbling = reflexos, defending = velocidade, physical = posicionamento.

Responda APENAS neste formato:
{
  "players": [
    {
      "name": "nome exatamente como veio na lista",
      "pace": 0, "shooting": 0, "passing": 0, "dribbling": 0, "defending": 0, "physical": 0,
      "overall": 0,
      "confidence": 0,
      "note": "uma frase curta justificando, máx 120 caracteres"
    }
  ]
}

Regras:
- Se você conhece o jogador real, use o que sabe do desempenho e do momento dele.
- Se não conhece, estime pelo nível do time, da competição e da posição, e diga isso em note.
- confidence vai de 0 a 100 e mede o quanto você reconhece o jogador, não o quanto ele é bom.
- overall precisa ser coerente com os atributos e com a posição.
- Devolva um item por jogador da lista, com o nome idêntico, sem inventar jogador que não está lá.`;
}

function parseEstimation(text: string, batch: PlayerToEstimate[]): EstimatedPlayer[] {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const candidate = cleaned.startsWith('{')
    ? cleaned
    : cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1);
  if (!candidate) return [];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.players)) return [];

  const byName = new Map(batch.map((player) => [player.name.toLowerCase(), player]));

  return (parsed.players as Array<Record<string, unknown>>)
    .map((row) => {
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      const target = byName.get(name.toLowerCase());
      if (!target) return null;

      const values = ATTRIBUTE_KEYS.map((key) => clampAttribute(row?.[key]));
      if (values.some((value) => value === null)) return null;

      const attributes = Object.fromEntries(
        ATTRIBUTE_KEYS.map((key, index) => [key, values[index]!]),
      ) as PlayerAttributes;
      const overall = clampAttribute(row?.overall) ?? overallFromAttributes(target.position, attributes);
      const confidence = Math.min(100, Math.max(0, Math.round(Number(row?.confidence)) || 0));

      return {
        name: target.name,
        attributes,
        overall,
        confidence,
        note: typeof row?.note === 'string' ? row.note.slice(0, 160) : '',
      };
    })
    .filter((row): row is EstimatedPlayer => row !== null);
}
