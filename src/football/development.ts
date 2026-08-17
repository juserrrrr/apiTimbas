import { ATTRIBUTE_KEYS, AttributeKey, clampAttribute } from './attributes';

export const MAX_FORM = 5;
export const MIN_FORM = -5;

export interface DevelopmentInput {
  position: string;
  birthDate: Date | null;
  form: number;
  ratingAvg: number | null;
  matchesPlayed: number;
  attributes: Partial<Record<AttributeKey, number | null>>;
}

export interface DevelopmentChange {
  key: AttributeKey;
  delta: 1 | -1;
  reason: 'evolução' | 'queda';
}

/// Nota boa empurra a forma, nota ruim derruba, e o meio puxa para zero. O teto é
/// baixo de propósito: forma é oscilação, não é o nível do jogador.
export function nextForm(form: number, rating: number): number {
  const step = rating >= 7.5 ? 2 : rating >= 6.8 ? 1 : rating <= 5 ? -2 : rating <= 6 ? -1 : form > 0 ? -1 : form < 0 ? 1 : 0;
  return Math.min(MAX_FORM, Math.max(MIN_FORM, form + step));
}

export function nextRatingAvg(ratingAvg: number | null, matchesPlayed: number, rating: number): number {
  if (ratingAvg === null || matchesPlayed <= 0) return round1(rating);
  return round1((ratingAvg * matchesPlayed + rating) / (matchesPlayed + 1));
}

export function ageAt(birthDate: Date | null, now: Date): number | null {
  if (!birthDate) return null;
  const years = (now.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return years > 14 && years < 50 ? Math.floor(years) : null;
}

/// Evolução lenta de propósito: um ponto por vez, e só depois de o jogador ter
/// jogado o bastante para a média valer algo. Sem data de nascimento o jogador
/// só melhora, nunca cai por idade, porque não sabemos a idade dele.
export function attributeChange(input: DevelopmentInput, roll: number, now: Date): DevelopmentChange | null {
  if (input.matchesPlayed < 4 || input.ratingAvg === null) return null;

  const age = ageAt(input.birthDate, now);
  const shining = input.ratingAvg >= 7.2 || (input.ratingAvg >= 6.9 && input.form >= 3);
  const fading = input.ratingAvg <= 6.2 || (input.ratingAvg <= 6.5 && input.form <= -3);

  const growthChance = age === null ? 0.12 : age <= 21 ? 0.3 : age <= 26 ? 0.18 : age <= 30 ? 0.1 : 0.04;
  const declineChance = age === null ? 0 : age >= 34 ? 0.28 : age >= 31 ? 0.16 : age >= 28 ? 0.06 : 0.02;

  if (shining && roll < growthChance) {
    const key = pickKey(input, roll, 'up');
    return key ? { key, delta: 1, reason: 'evolução' } : null;
  }
  if (fading && roll > 1 - declineChance) {
    const key = pickKey(input, roll, 'down');
    return key ? { key, delta: -1, reason: 'queda' } : null;
  }
  return null;
}

export function applyChange(
  attributes: Partial<Record<AttributeKey, number | null>>,
  change: DevelopmentChange,
): Record<AttributeKey, number> | null {
  const current = attributes[change.key];
  if (current === null || current === undefined) return null;

  const updated = {} as Record<AttributeKey, number>;
  for (const key of ATTRIBUTE_KEYS) {
    const value = attributes[key];
    if (value === null || value === undefined) return null;
    updated[key] = value;
  }
  updated[change.key] = clampAttribute(current + change.delta)!;
  return updated;
}

/// Cresce no que a posição usa mais, cai no que depende de corpo e velocidade,
/// que é o que a idade tira primeiro.
function pickKey(input: DevelopmentInput, roll: number, direction: 'up' | 'down'): AttributeKey | null {
  const candidates = direction === 'up' ? growthKeys(input.position) : ['pace', 'physical'] as AttributeKey[];
  const available = candidates.filter((key) => typeof input.attributes[key] === 'number');
  if (available.length === 0) return null;
  return available[Math.floor(roll * 1000) % available.length];
}

function growthKeys(position: string): AttributeKey[] {
  const upper = position.toUpperCase();
  if (upper === 'GOL') return ['dribbling', 'defending', 'physical'];
  if (['ZAG', 'LD', 'LE'].includes(upper)) return ['defending', 'physical', 'passing'];
  if (['VOL', 'MC', 'MEI'].includes(upper)) return ['passing', 'dribbling', 'physical'];
  return ['shooting', 'dribbling', 'pace'];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
