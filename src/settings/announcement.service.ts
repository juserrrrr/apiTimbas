import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SettingsService } from './settings.service';

const KEY = 'platform.latest-announcement';

export interface PlatformAnnouncement {
  id: string;
  title: string;
  summary: string;
  content: string;
  publishedAt: string;
}

@Injectable()
export class AnnouncementService {
  constructor(private readonly settings: SettingsService) {}

  async latest(): Promise<PlatformAnnouncement | null> {
    const raw = (await this.settings.getMany([KEY])).get(KEY);
    if (!raw) return null;
    try {
      return this.sanitizeStored(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async publish(input: unknown): Promise<PlatformAnnouncement> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Preencha os dados da novidade.');
    }
    const row = input as Record<string, unknown>;
    const title = this.text(row.title, 'Título', 120);
    const summary = this.text(row.summary, 'Resumo', 240, true);
    const content = this.text(row.content, 'Conteúdo', 20_000);
    const announcement: PlatformAnnouncement = {
      id: randomUUID(),
      title,
      summary,
      content,
      publishedAt: new Date().toISOString(),
    };
    await this.settings.set(KEY, JSON.stringify(announcement));
    return announcement;
  }

  private sanitizeStored(input: unknown): PlatformAnnouncement | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const row = input as Record<string, unknown>;
    if (
      typeof row.id !== 'string' ||
      typeof row.title !== 'string' ||
      typeof row.summary !== 'string' ||
      typeof row.content !== 'string' ||
      typeof row.publishedAt !== 'string'
    ) return null;
    return {
      id: row.id,
      title: row.title,
      summary: row.summary,
      content: row.content,
      publishedAt: row.publishedAt,
    };
  }

  private text(value: unknown, label: string, maximum: number, optional = false) {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${label} inválido.`);
    }
    const text = value.trim();
    if (!optional && !text) throw new BadRequestException(`${label} é obrigatório.`);
    if (text.length > maximum) throw new BadRequestException(`${label} aceita no máximo ${maximum} caracteres.`);
    return text;
  }
}
