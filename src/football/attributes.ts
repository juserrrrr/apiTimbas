/// Os seis atributos do card, na ordem do EA FC. Goleiro usa as mesmas seis
/// colunas com outro significado, igual ao card do jogo, por isso os rótulos
/// dependem da posição.
export const ATTRIBUTE_KEYS = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'] as const;

export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
export type PlayerAttributes = Record<AttributeKey, number>;

const OUTFIELD_LABELS = ['Ritmo', 'Finalização', 'Passe', 'Drible', 'Defesa', 'Físico'];
const GOALKEEPER_LABELS = ['Elasticidade', 'Manejo', 'Chute', 'Reflexos', 'Velocidade', 'Posicionamento'];

/// Peso de cada atributo por posição, usado só quando falta o overall. A soma de
/// cada linha é 100.
const WEIGHTS: Record<string, number[]> = {
  GOL: [10, 5, 5, 10, 35, 35],
  ZAG: [10, 5, 10, 5, 45, 25],
  LD: [25, 10, 20, 15, 20, 10],
  LE: [25, 10, 20, 15, 20, 10],
  VOL: [10, 10, 25, 15, 25, 15],
  MC: [10, 15, 30, 20, 15, 10],
  MEI: [15, 20, 30, 25, 5, 5],
  PD: [30, 20, 15, 25, 5, 5],
  PE: [30, 20, 15, 25, 5, 5],
  ATA: [20, 35, 10, 20, 5, 10],
};

const DEFAULT_WEIGHTS = [20, 15, 20, 20, 15, 10];

export function isGoalkeeper(position: string): boolean {
  return position.toUpperCase() === 'GOL';
}

export function attributeLabels(position: string): string[] {
  return isGoalkeeper(position) ? GOALKEEPER_LABELS : OUTFIELD_LABELS;
}

export function clampAttribute(value: unknown): number | null {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded)) return null;
  return Math.min(99, Math.max(1, rounded));
}

/// Média ponderada pela posição, no formato do overall do card.
export function overallFromAttributes(position: string, attributes: PlayerAttributes): number {
  const weights = WEIGHTS[position.toUpperCase()] ?? DEFAULT_WEIGHTS;
  const total = ATTRIBUTE_KEYS.reduce(
    (sum, key, index) => sum + attributes[key] * weights[index],
    0,
  );
  return Math.min(99, Math.max(1, Math.round(total / 100)));
}
