import { Injectable } from '@nestjs/common';
import { Context, SlashCommand, SlashCommandContext } from 'necord';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { WalletService } from '../../engagement/wallet.service';

@Injectable()
export class FichasCommand {
  constructor(private readonly walletService: WalletService) {}

  @SlashCommand({ name: 'fichas', description: 'Mostra seu saldo de fichas e os mais ricos do servidor.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onFichas(@Context() [interaction]: SlashCommandContext) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const serverId = interaction.guild!.id;

    const [balance, top] = await Promise.all([
      this.walletService.getBalance(serverId, interaction.user.id),
      this.walletService.topBalances(serverId, 5),
    ]);

    const ranking = top.length
      ? top.map((w, i) => `${['🥇', '🥈', '🥉', '4.', '5.'][i]} <@${w.discordId}> — 🪙 **${w.balance}**`).join('\n')
      : '_ninguém tem fichas ainda_';

    const embed = new EmbedBuilder()
      .setTitle('🪙 Suas fichas')
      .setColor(0xfbbf24)
      .setDescription(`Você tem **${balance}** fichas.`)
      .addFields(
        { name: '💰 Mais ricos do servidor', value: ranking },
        {
          name: '📈 Como ganhar fichas',
          value: '• Jogar partida: **+10** (vencer: **+10** extra)\n• Ser eleito MVP: **+25**\n• Acertar aposta (🎰 no lobby): **dobra** o valor apostado',
        },
      );

    await interaction.editReply({ embeds: [embed] });
  }
}
