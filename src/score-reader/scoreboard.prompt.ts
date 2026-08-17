import { DetectedScoreboard } from './score-reader.types';

export const SCOREBOARD_SYSTEM_PROMPT =
  'Você lê placares finais de partidas em capturas de tela de jogos. Responda somente com JSON válido, sem markdown e sem texto fora do JSON. Nunca invente times ou números que não estejam visíveis.';

export function buildScoreboardPrompt(input: {
  homeName: string;
  awayName: string;
  gameLabel: string;
  extractedText?: string;
}): string {
  const source = input.extractedText
    ? `TEXTO EXTRAÍDO DA IMAGEM POR OCR:\n"""\n${input.extractedText.slice(0, 6000)}\n"""`
    : 'A imagem da partida está anexada nesta mensagem.';

  return `Jogo: ${input.gameLabel}
Times esperados nesta partida: "${input.homeName}" (mandante) e "${input.awayName}" (visitante).

${source}

Extraia o placar FINAL da partida e responda neste formato:
{
  "leftTeam": "nome do time que aparece à esquerda no placar",
  "leftScore": 0,
  "rightTeam": "nome do time que aparece à direita no placar",
  "rightScore": 0,
  "confidence": 0,
  "notes": "o que você viu, ou o que impediu a leitura (máx 160 caracteres)"
}

Regras:
- leftScore e rightScore são inteiros de 0 a 99.
- confidence é um inteiro de 0 a 100 medindo o quanto você confia na leitura.
- Se a imagem não for um placar, estiver ilegível ou for de outra partida, use confidence 0 e explique em notes.
- Se os nomes visíveis não baterem com os times esperados, informe os nomes que você realmente viu e reduza a confidence.
- Se o placar mostrado for de disputa de pênaltis, informe o placar do tempo normal em leftScore/rightScore e cite os pênaltis em notes.`;
}

export function parseScoreboard(text: string): DetectedScoreboard | null {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const candidate = cleaned.startsWith('{') ? cleaned : cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1);
  if (!candidate) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  const leftScore = toScore(parsed.leftScore);
  const rightScore = toScore(parsed.rightScore);
  if (leftScore === null || rightScore === null) return null;

  return {
    leftTeam: toText(parsed.leftTeam),
    leftScore,
    rightTeam: toText(parsed.rightTeam),
    rightScore,
    confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0))),
    notes: toText(parsed.notes).slice(0, 200),
  };
}

function toScore(value: unknown): number | null {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 99 ? parsed : null;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
