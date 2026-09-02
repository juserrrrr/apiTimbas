import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';

const TICKET_TTL_MS = 60_000;

@Injectable()
export class GameTicketsService {
  private readonly tickets = new Map<
    string,
    { discordId: string; expiresAt: number }
  >();

  issue(discordId: string): string {
    const ticket = randomUUID();
    this.tickets.set(ticket, {
      discordId,
      expiresAt: Date.now() + TICKET_TTL_MS,
    });
    return ticket;
  }

  consume(ticket?: string): string | null {
    if (!ticket) return null;
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.discordId;
  }

  @Interval(60_000)
  cleanup() {
    const now = Date.now();
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt < now) this.tickets.delete(ticket);
    }
  }
}
