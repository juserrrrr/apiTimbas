import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable, catchError, EMPTY } from 'rxjs';
import { Client, EmbedBuilder, Interaction, MessageFlags } from 'discord.js';

const OWNER_ID = '352240724693090305';

@Injectable()
export class DiscordErrorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DiscordErrorInterceptor.name);

  constructor(private readonly client: Client) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError(async (error) => {
        let interaction: Interaction | undefined;
        try {
          const data = context.switchToRpc().getData();
          interaction = Array.isArray(data) ? data[0] : undefined;
        } catch {}

        await this.notifyOwner(error, interaction);
        await this.replyToUser(error, interaction);

        return EMPTY;
      }),
    );
  }

  private async notifyOwner(error: Error, interaction?: Interaction) {
    try {
      const owner = this.client.users.cache.get(OWNER_ID) ?? await this.client.users.fetch(OWNER_ID);
      if (!owner) return;

      const guild = (interaction as any)?.guild?.name ?? 'DM';
      const commandName = (interaction as any)?.commandName ?? (interaction as any)?.customId ?? 'N/A';
      const user = (interaction as any)?.user;
      const timestamp = Math.floor(((interaction as any)?.createdAt ?? new Date()).getTime() / 1000);
      const trace = (error?.stack ?? String(error)).slice(0, 1800);

      await owner.send(
        `Um erro ocorreu em '${guild}':\n` +
        `Comando: \`${commandName}\`\n` +
        `Usuário: \`${user?.tag ?? user?.username ?? 'N/A'}\` (ID: ${user?.id ?? 'N/A'})\n` +
        `Timestamp: <t:${timestamp}:F>\n` +
        `\`\`\`py\n${trace}\n\`\`\``,
      );
    } catch (e) {
      this.logger.error(`Failed to notify owner: ${e}`);
    }
  }

  private async replyToUser(error: any, interaction?: Interaction) {
    if (!interaction) return;

    let message = 'Aconteceu um erro interno ao executar o comando, o mesmo já foi registrado.';

    if (error?.name === 'CommandOnCooldown') {
      message = `Este comando está em tempo de recarga. Tente novamente em ${error.retryAfter?.toFixed(2) ?? '?'} segundos.`;
    } else if (error?.name === 'MissingPermissions') {
      message = 'Você não tem permissão para usar este comando.';
    }

    const embed = new EmbedBuilder().setDescription(message).setColor(0xff0000);

    try {
      const i = interaction as any;
      if (i.replied || i.deferred) {
        const msg = await i.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral, fetchReply: true });
        setTimeout(() => msg.delete().catch(() => {}), 10_000);
      } else if (i.reply) {
        await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        setTimeout(() => i.deleteReply().catch(() => {}), 10_000);
      }
    } catch (e) {
      this.logger.error(`Failed to reply error to user: ${e}`);
    }
  }
}
