import { BadRequestException, Injectable } from '@nestjs/common';
import { SettingsService } from './settings.service';

const KEY = 'tournament.award-card-layouts';
const CATEGORIES = ['artilheiro', 'garcom', 'craque', 'maestro', 'xerife', 'muralha'] as const;
const FONTS = ['anton', 'tourney', 'cinzel', 'black-ops', 'graduate', 'teko'] as const;

export type AwardCardCategory = (typeof CATEGORIES)[number];
export type AwardCardFont = (typeof FONTS)[number];

export interface AwardCardLayoutSetting {
  font: AwardCardFont;
  nickX: number;
  nickY: number;
  nickSize: number;
  statX: number;
  statY: number;
  statSize: number;
  qrX: number;
  qrY: number;
  qrSize: number;
  textWidth: number;
}

export type AwardCardLayoutSettings = Partial<Record<AwardCardCategory, AwardCardLayoutSetting>>;

@Injectable()
export class AwardCardSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async get(): Promise<AwardCardLayoutSettings> {
    const raw = (await this.settings.getMany([KEY])).get(KEY);
    if (!raw) return {};
    try {
      return this.sanitize(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  async save(input: unknown): Promise<AwardCardLayoutSettings> {
    const value = this.sanitize(input, true);
    await this.settings.set(KEY, JSON.stringify(value));
    return value;
  }

  private sanitize(input: unknown, strict = false): AwardCardLayoutSettings {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      if (strict) throw new BadRequestException('Configuração dos cards inválida.');
      return {};
    }
    const source = input as Record<string, unknown>;
    const result: AwardCardLayoutSettings = {};
    for (const category of CATEGORIES) {
      const raw = source[category];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const font = typeof row.font === 'string' && FONTS.includes(row.font as AwardCardFont)
        ? row.font as AwardCardFont
        : null;
      if (!font) {
        if (strict) throw new BadRequestException(`Fonte inválida em ${category}.`);
        continue;
      }
      result[category] = {
        font,
        nickX: this.number(row.nickX, 0.15, 0.85, strict),
        nickY: this.number(row.nickY, 0.5, 0.92, strict),
        nickSize: this.number(row.nickSize, 0.025, 0.12, strict),
        statX: this.number(row.statX, 0.15, 0.85, strict),
        statY: this.number(row.statY, 0.55, 0.95, strict),
        statSize: this.number(row.statSize, 0.02, 0.09, strict),
        qrX: this.number(row.qrX, 0.4, 0.9, strict),
        qrY: this.number(row.qrY, 0.5, 0.9, strict),
        qrSize: this.number(row.qrSize, 0.06, 0.22, strict),
        textWidth: this.number(row.textWidth, 0.2, 0.7, strict),
      };
    }
    return result;
  }

  private number(value: unknown, minimum: number, maximum: number, strict: boolean) {
    const parsed = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(parsed)) {
      if (strict) throw new BadRequestException('Uma coordenada do card é inválida.');
      return minimum;
    }
    return Math.min(maximum, Math.max(minimum, parsed));
  }
}
