import { Injectable, Logger } from '@nestjs/common';
import { Once, On, Context, ContextOf } from 'necord';
import { Client, ActivityType } from 'discord.js';
import { EventStateService } from '../services/event-state.service';
import { EventoCommand } from '../commands/evento.command';

const INTERVAL_MS = 20_000;

@Injectable()
export class ReadyEvent {
  private readonly logger = new Logger(ReadyEvent.name);
  private presenceInterval: NodeJS.Timeout | null = null;
  private presenceIndex = 0;

  constructor(
    private readonly client: Client,
    private readonly eventStateService: EventStateService,
    private readonly eventoCommand: EventoCommand,
  ) {}

  @Once('clientReady')
  async onReady(@Context() [client]: ContextOf<'clientReady'>) {
    this.logger.log(`Bot online como ${client.user.tag} em ${client.guilds.cache.size} servidor(es)`);

    // Sync slash commands
    await client.application.commands.fetch();

    // Restore persistent event views (re-send is not needed; buttons are registered globally)
    // Events are restored via interaction handlers that look up EventStateService

    // Start presence cycling
    this.startPresenceCycle();
  }

  private startPresenceCycle() {
    if (this.presenceInterval) clearInterval(this.presenceInterval);
    this.presenceInterval = setInterval(async () => {
      const activities = [
        { name: 'v0.7', type: ActivityType.Streaming, url: 'https://www.twitch.tv/juserrrrr' },
        { name: `${this.client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)} membros`, type: ActivityType.Streaming, url: 'https://www.twitch.tv/juserrrrr' },
      ];
      const act = activities[this.presenceIndex % activities.length];
      this.presenceIndex++;
      try { this.client.user!.setActivity(act); } catch {}
    }, INTERVAL_MS);
  }
}
