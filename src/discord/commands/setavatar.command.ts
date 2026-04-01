import { Injectable } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext, StringOption } from 'necord';
import { Client } from 'discord.js';
import axios from 'axios';

const DEFAULT_AVATAR_URL = 'https://i.imgur.com/zcJBDUq_d.webp';

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
    if (interaction.user.id !== interaction.guild!.ownerId) {
      await interaction.reply({ content: '❌ Apenas o dono do servidor pode usar este comando.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const imageUrl = url ?? DEFAULT_AVATAR_URL;

    try {
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      await this.client.user!.setAvatar(buffer);
      await interaction.followUp({ content: '✅ Avatar atualizado!', ephemeral: true });
    } catch (e) {
      await interaction.followUp({ content: `❌ Falha ao definir avatar: ${e}`, ephemeral: true });
    }
  }
}
