import { Injectable } from '@nestjs/common';
import { BooleanOption, Context, Options, SlashCommand, SlashCommandContext } from 'necord';
import { GuildMember, MessageFlags } from 'discord.js';

const BOT_OWNER_ID = '352240724693090305';
const SUFFIX = ' VAI BRASA';
const MAX_NICKNAME_LENGTH = 32;

class VaiBrasaOptions {
  @BooleanOption({ name: 'flag', description: 'true = adiciona "VAI BRASA"; false = remove o apelido (volta ao normal)', required: true })
  flag!: boolean;
}

@Injectable()
export class VaiBrasaCommand {
  @SlashCommand({ name: 'vaibrasa', description: 'Adiciona/remove "VAI BRASA" no nick de todos do servidor.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onVaiBrasa(
    @Context() [interaction]: SlashCommandContext,
    @Options() { flag }: VaiBrasaOptions,
  ) {
    if (interaction.user.id !== BOT_OWNER_ID) {
      await interaction.reply({ content: '❌ Apenas o dono do bot pode usar este comando.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild!;

    // Garante que temos todos os membros em cache (não só os ativos).
    const members = await guild.members.fetch();

    let changed = 0;
    let failed = 0;

    await Promise.allSettled(
      members.map(async (member: GuildMember) => {
        // Não mexe em bots.
        if (member.user.bot) return;

        if (flag) {
          // Se o nome já tem "VAI BRASA", não muda.
          if (member.displayName.includes(SUFFIX.trim())) return;

          // Trunca o nome base para caber junto do sufixo no limite do Discord.
          const baseName = member.displayName.slice(0, MAX_NICKNAME_LENGTH - SUFFIX.length).trimEnd();
          const newNick = `${baseName}${SUFFIX}`;

          if (member.nickname === newNick) return;

          try {
            await member.setNickname(newNick);
            changed++;
          } catch {
            // Falha esperada para o dono do servidor e membros com cargo acima do bot.
            failed++;
          }
        } else {
          // Remove o apelido: passando null o Discord volta ao username padrão.
          if (member.nickname === null) return;

          try {
            await member.setNickname(null);
            changed++;
          } catch {
            // Falha esperada para o dono do servidor e membros com cargo acima do bot.
            failed++;
          }
        }
      }),
    );

    const action = flag ? 'atualizado(s)' : 'resetado(s)';
    const msg = await interaction.followUp({
      content: `✅ ${changed} nick(s) ${action}.${failed ? ` ⚠️ ${failed} não puderam ser alterados (cargo acima do bot ou dono do servidor).` : ''}`,
      flags: MessageFlags.Ephemeral,
    });
    setTimeout(() => msg.delete().catch(() => {}), 8000);
  }
}
