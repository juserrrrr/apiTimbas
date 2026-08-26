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
  nickAutoFit: boolean;
  statAutoFit: boolean;
}

export type AwardCardLayoutSettings = Partial<Record<AwardCardCategory, AwardCardLayoutSetting>>;

export interface ChampionCardLayoutSetting {
  font: AwardCardFont;
  championTitleX: number;
  championTitleY: number;
  championTitleSize: number;
  championTitleWidth: number;
  teamX: number;
  teamY: number;
  teamSize: number;
  teamWidth: number;
  tournamentX: number;
  tournamentY: number;
  tournamentSize: number;
  tournamentWidth: number;
  rosterX: number;
  rosterY: number;
  rosterWidth: number;
  rosterHeight: number;
  rosterSize: number;
  rosterColumns: number;
  rosterTitleX: number;
  rosterTitleY: number;
  rosterTitleSize: number;
  rosterTitleWidth: number;
  qrX: number;
  qrY: number;
  qrSize: number;
}

export type CompleteAwardCardLayoutSettings = AwardCardLayoutSettings & {
  campeao?: ChampionCardLayoutSetting;
};

@Injectable()
export class AwardCardSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async get(): Promise<CompleteAwardCardLayoutSettings> {
    const raw = (await this.settings.getMany([KEY])).get(KEY);
    if (!raw) return {};
    try {
      return this.sanitize(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  async save(input: unknown): Promise<CompleteAwardCardLayoutSettings> {
    const value = this.sanitize(input, true);
    const merged = { ...(await this.get()), ...value };
    await this.settings.set(KEY, JSON.stringify(merged));
    return merged;
  }

  private sanitize(input: unknown, strict = false): CompleteAwardCardLayoutSettings {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      if (strict) throw new BadRequestException('Configuração dos cards inválida.');
      return {};
    }
    const source = input as Record<string, unknown>;
    const result: CompleteAwardCardLayoutSettings = {};
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
        nickAutoFit: this.boolean(row.nickAutoFit, true, strict),
        statAutoFit: this.boolean(row.statAutoFit, true, strict),
      };
    }
    const championRaw = source.campeao;
    if (championRaw && typeof championRaw === 'object' && !Array.isArray(championRaw)) {
      const row = championRaw as Record<string, unknown>;
      const font = typeof row.font === 'string' && FONTS.includes(row.font as AwardCardFont)
        ? row.font as AwardCardFont
        : null;
      if (!font) {
        if (strict) throw new BadRequestException('Fonte inválida em campeão.');
      } else {
        result.campeao = {
          font,
          championTitleX: this.numberWithFallback(row.championTitleX, 0.5, 0.15, 0.85, strict),
          championTitleY: this.numberWithFallback(row.championTitleY, 0.612, 0.55, 0.72, strict),
          championTitleSize: this.numberWithFallback(row.championTitleSize, 0.026, 0.012, 0.06, strict),
          championTitleWidth: this.numberWithFallback(row.championTitleWidth, 0.18, 0.08, 0.85, strict),
          teamX: this.number(row.teamX, 0.15, 0.85, strict),
          teamY: this.number(row.teamY, 0.55, 0.75, strict),
          teamSize: this.number(row.teamSize, 0.025, 0.1, strict),
          teamWidth: this.number(row.teamWidth, 0.3, 0.85, strict),
          tournamentX: this.number(row.tournamentX, 0.15, 0.85, strict),
          tournamentY: this.number(row.tournamentY, 0.58, 0.78, strict),
          tournamentSize: this.number(row.tournamentSize, 0.012, 0.06, strict),
          tournamentWidth: this.number(row.tournamentWidth, 0.3, 0.85, strict),
          rosterX: this.number(row.rosterX, 0.1, 0.65, strict),
          rosterY: this.number(row.rosterY, 0.7, 0.86, strict),
          rosterWidth: this.number(row.rosterWidth, 0.2, 0.65, strict),
          rosterHeight: this.number(row.rosterHeight, 0.04, 0.16, strict),
          rosterSize: this.number(row.rosterSize, 0.007, 0.04, strict),
          rosterColumns: this.integer(row.rosterColumns, 1, 4, strict),
          rosterTitleX: this.numberWithFallback(row.rosterTitleX, 0.415, 0.1, 0.75, strict),
          rosterTitleY: this.numberWithFallback(row.rosterTitleY, 0.73, 0.68, 0.82, strict),
          rosterTitleSize: this.numberWithFallback(row.rosterTitleSize, 0.017, 0.009, 0.04, strict),
          rosterTitleWidth: this.numberWithFallback(row.rosterTitleWidth, 0.18, 0.1, 0.85, strict),
          qrX: this.number(row.qrX, 0.5, 0.86, strict),
          qrY: this.number(row.qrY, 0.65, 0.86, strict),
          qrSize: this.number(row.qrSize, 0.06, 0.2, strict),
        };
      }
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

  private numberWithFallback(
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number,
    strict: boolean,
  ) {
    if (value === undefined) return fallback;
    return this.number(value, minimum, maximum, strict);
  }

  private boolean(value: unknown, fallback: boolean, strict: boolean) {
    if (value === undefined) return fallback;
    if (typeof value === 'boolean') return value;
    if (strict) throw new BadRequestException('Uma opção de ajuste do card é inválida.');
    return fallback;
  }

  private integer(value: unknown, minimum: number, maximum: number, strict: boolean) {
    return Math.round(this.number(value, minimum, maximum, strict));
  }
}
