import { Injectable } from '@nestjs/common';
import { Context, SlashCommand, SlashCommandContext } from 'necord';
import { GuildMember, VoiceChannel } from 'discord.js';

@Injectable()
export class TrazertodosCommand {
  @SlashCommand({ name: 'puxartodos', description: 'Move todos os usuários de outros canais de voz para o seu canal.', guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined })
  async onPuxartodos(@Context() [interaction]: SlashCommandContext) {
    const member = interaction.member as GuildMember;
    if (!member.voice.channel) {
      await interaction.reply({ content: '❌ Você precisa estar em um canal de voz.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const targetChannel = member.voice.channel as VoiceChannel;
    const guild = interaction.guild!;

    const toMove = guild.members.cache.filter(
      (m) => m.voice.channel && m.voice.channel.id !== targetChannel.id,
    );

    if (!toMove.size) {
      const msg = await interaction.followUp({ content: 'Não há usuários para mover.', ephemeral: true });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    await Promise.allSettled(toMove.map((m) => m.voice.setChannel(targetChannel)));
    const msg = await interaction.followUp({ content: `✅ ${toMove.size} usuário(s) movido(s) para ${targetChannel.name}.`, ephemeral: true });
    setTimeout(() => msg.delete().catch(() => {}), 5000);
  }
}
