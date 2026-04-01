import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

const EVENTS_FILE = path.join(process.cwd(), 'data', 'discord_events.json');
const EVENT_TTL = 86400 * 1000; // 1 day in ms

export interface EventEntry {
  messageId: string;
  creatorId: string;
  titulo: string;
  descricao: string | null;
  horario: string | null;
  goingIds: string[];
  notGoingIds: string[];
  createdAt: number;
}

@Injectable()
export class EventStateService {
  private readonly logger = new Logger(EventStateService.name);
  private events: Map<string, EventEntry> = new Map();

  onModuleInit() {
    this.load();
    this.purgeExpired();
  }

  private load() {
    try {
      if (fs.existsSync(EVENTS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf-8')) as Record<string, EventEntry>;
        this.events = new Map(Object.entries(raw));
      }
    } catch (e) {
      this.logger.warn(`Failed to load events file: ${e}`);
    }
  }

  private save() {
    try {
      fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
      const obj = Object.fromEntries(this.events.entries());
      fs.writeFileSync(EVENTS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (e) {
      this.logger.warn(`Failed to save events file: ${e}`);
    }
  }

  private purgeExpired() {
    const now = Date.now();
    for (const [id, ev] of this.events.entries()) {
      if (now - ev.createdAt > EVENT_TTL) this.events.delete(id);
    }
    this.save();
  }

  upsert(entry: EventEntry) {
    const existing = this.events.get(entry.messageId);
    this.events.set(entry.messageId, {
      ...entry,
      createdAt: existing?.createdAt ?? entry.createdAt,
    });
    this.save();
  }

  get(messageId: string): EventEntry | undefined {
    return this.events.get(messageId);
  }

  getAll(): EventEntry[] {
    return [...this.events.values()];
  }

  delete(messageId: string) {
    this.events.delete(messageId);
    this.save();
  }
}
