import { Injectable } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext, StringOption } from 'necord';
import { Client, MessageFlags } from 'discord.js';
import axios from 'axios';
import { URL } from 'url';

const DEFAULT_AVATAR_URL = 'https://i.imgur.com/zcJBDUq_d.webp?maxwidth=760&fidelity=grand';
const BOT_OWNER_ID = '352240724693090305';
const ALLOWED_DOMAINS = ['imgur.com', 'i.imgur.com', 'discord.com', 'cdn.discordapp.com'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

class SetAvatarOptions {
  @StringOption({ name: 'url', description: 'URL da imagem (deixe em branco para usar o padrão)', required: false })
  url?: string;
}

@Injectable()
export class SetAvatarCommand {
  constructor(private readonly client: Client) {}

  private isValidImageUrl(urlString: string): boolean {
    try {
      const url = new URL(urlString);
      // Only allow HTTPS
      if (url.protocol !== 'https:') return false;
      // Whitelist allowed domains
      const hostname = url.hostname.toLowerCase();
      return ALLOWED_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
    } catch {
      return false;
    }
  }

  @SlashCommand({ name: 'setavatar', description: 'Define o avatar do bot.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onSetAvatar(
    @Context() [interaction]: SlashCommandContext,
    @Options() { url }: SetAvatarOptions,
  ) {
    if (interaction.user.id !== BOT_OWNER_ID) {
      await interaction.reply({ content: '❌ Apenas o dono do bot pode usar este comando.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const imageUrl = url ?? DEFAULT_AVATAR_URL;

    // Validate URL to prevent SSRF
    if (!this.isValidImageUrl(imageUrl)) {
      const msg = await interaction.followUp({ content: '❌ URL inválida ou não permitida.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 5000,
        maxContentLength: MAX_IMAGE_SIZE,
      });
      const buffer = Buffer.from(response.data);
      await this.client.user!.setAvatar(buffer);
      const msg = await interaction.followUp({ content: '✅ Avatar atualizado com sucesso!', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
    } catch (e) {
      // Don't expose error details to prevent information leakage
      const msg = await interaction.followUp({ content: '❌ Falha ao atualizar avatar. Verifique a URL.', flags: MessageFlags.Ephemeral });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
    }
  }
}
