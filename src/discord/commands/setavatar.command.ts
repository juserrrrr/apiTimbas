import { Injectable } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext, StringOption } from 'necord';
import { Client } from 'discord.js';
import axios from 'axios';

const DEFAULT_AVATAR_URL = 'https://i.imgur.com/zcJBDUq_d.webp?maxwidth=760&fidelity=grand';
const BOT_OWNER_ID = '352240724693090305';

class SetAvatarOptions {
  @StringOption({ name: 'url', description: 'URL da imagem (deixe em branco para usar o padrão)', required: false })
  url?: string;
}

@Injectable()
export class SetAvatarCommand {
  constructor(private readonly client: Client) {}

  @SlashCommand({ name: 'setavatar', description: 'Define o avatar do bot.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onSetAvatar(
    @Context() [interaction]: SlashCommandContext,
    @Options() { url }: SetAvatarOptions,
  ) {
    if (interaction.user.id !== BOT_OWNER_ID) {
      await interaction.reply({ content: '❌ Apenas o dono do bot pode usar este comando.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const imageUrl = url ?? DEFAULT_AVATAR_URL;

    try {
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      await this.client.user!.setAvatar(buffer);
      const msg = await interaction.followUp({ content: '✅ Avatar atualizado com sucesso!', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
    } catch (e) {
      const msg = await interaction.followUp({ content: `❌ Falha ao definir avatar: ${e}`, ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
    }
  }
}
