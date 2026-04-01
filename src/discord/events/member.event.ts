import { Injectable, Logger } from '@nestjs/common';
import { On, Context, ContextOf } from 'necord';
import { Client, EmbedBuilder } from 'discord.js';

const DOOR_CHANNEL_ID = '919076619451269160';

@Injectable()
export class MemberEvent {
  private readonly logger = new Logger(MemberEvent.name);

  constructor(private readonly client: Client) {}

  @On('guildMemberAdd')
  async onMemberJoin(@Context() [member]: ContextOf<'guildMemberAdd'>) {
    const channel = this.client.channels.cache.get(DOOR_CHANNEL_ID) as any;
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle('🎉 │ Bem-vindo(a)!')
      .setDescription(`**${member.user.username}** acaba de entrar para o ${member.guild.name}.`)
      .setColor(0x00ff23)
      .setThumbnail(member.displayAvatarURL({ extension: 'png' }));

    await channel.send({ content: `${member}`, embeds: [embed] }).catch(() => {});
  }

  @On('guildBanAdd')
  async onMemberBan(@Context() [ban]: ContextOf<'guildBanAdd'>) {
    const channel = this.client.channels.cache.get(DOOR_CHANNEL_ID) as any;
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle('⛔ │ Já vai tarde.')
      .setDescription(`**${ban.user.username}** acaba de ser banido do ${ban.guild.name}.`)
      .setColor(0xff0004)
      .setThumbnail(ban.user.displayAvatarURL({ extension: 'png' }));

    await channel.send({ content: `${ban.user}`, embeds: [embed] }).catch(() => {});
  }

  @On('guildMemberRemove')
  async onMemberRemove(@Context() [member]: ContextOf<'guildMemberRemove'>) {
    // Skip if the member was banned
    try {
      await member.guild.bans.fetch(member.id);
      return; // was banned, skip
    } catch {
      // not banned
    }

    const channel = this.client.channels.cache.get(DOOR_CHANNEL_ID) as any;
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle('🏃 │ Até a próxima!')
      .setDescription(`**${member.user.username}** acaba de sair do ${member.guild.name}.`)
      .setColor(0xff0004)
      .setThumbnail(member.displayAvatarURL({ extension: 'png' }));

    await channel.send({ content: `${member.user}`, embeds: [embed] }).catch(() => {});
  }
}
