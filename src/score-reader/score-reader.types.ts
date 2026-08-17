export interface ScoreReadRequest {
  imageBase64: string;
  mimeType: string;
  homeName: string;
  awayName: string;
  gameLabel: string;
}

export interface ScoreReading {
  available: boolean;
  provider: string | null;
  model: string | null;
  homeScore: number | null;
  awayScore: number | null;
  confidence: number;
  notes: string;
  raw: unknown;
}

export interface DetectedScoreboard {
  leftTeam: string;
  leftScore: number;
  rightTeam: string;
  rightScore: number;
  confidence: number;
  notes: string;
}

export const UNAVAILABLE_READING: ScoreReading = {
  available: false,
  provider: null,
  model: null,
  homeScore: null,
  awayScore: null,
  confidence: 0,
  notes: 'Leitura automática desativada. A prova precisa de aprovação manual.',
  raw: null,
};
