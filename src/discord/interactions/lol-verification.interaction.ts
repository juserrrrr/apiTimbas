import { Injectable, Logger } from '@nestjs/common';
import { Button, ComponentParam, Context, ButtonContext, Modal, ModalContext, ModalParam } from 'necord';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { RiotService } from '../../riot/riot.service';
import { UserService } from '../../user/user.service';
import { randomUUID } from 'crypto';

interface VerificationSession {
  puuid: string;
  iconId: number;
  playerData: any;
  userId: string;
}

const sessions = new Map<string, VerificationSession>();

@Injectable()
export class LolVerificationInteraction {
  private readonly logger = new Logger(LolVerificationInteraction.name);

  constructor(
    private readonly riotService: RiotService,
    private readonly userService: UserService,
  ) {}

  @Modal('lol_verify')
  async onVerifyModal(@Context() [interaction]: ModalContext) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const username = interaction.fields.getTextInputValue('league_name').trim();
    const parts = username.split('#');
    if (parts.length < 2) {
      await interaction.followUp({ content: '❌ Formato inválido. Use Nickname#TAG', flags: MessageFlags.Ephemeral });
      return;
    }

    const [gameName, tag] = parts;
    try {
      const data = await this.riotService.getPlayerInfo(gameName, tag);
      if (!data) {
        await interaction.editReply('❌ Conta não encontrada. Verifique o nick e a tag.');
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
      }

      const currentIconId = data.profileIconId;
      const available = Array.from({ length: 29 }, (_, i) => i + 1).filter((i) => i !== currentIconId);
      const verificationIconId = available[Math.floor(Math.random() * available.length)];

      const sessionKey = randomUUID();
      sessions.set(sessionKey, {
        puuid: data.puuid,
        iconId: verificationIconId,
        playerData: data,
        userId: interaction.user.id,
      });
      setTimeout(() => sessions.delete(sessionKey), 180_000);

      const iconUrl = `https://ddragon.leagueoflegends.com/cdn/14.8.1/img/profileicon/${verificationIconId}.png`;
      const embed = new EmbedBuilder()
        .setTitle(`É você, ${data.gameName ?? gameName}?`)
        .setDescription('Para confirmar que a conta é sua, mude seu ícone de perfil no LoL para o ícone abaixo e clique em **Verificar**.')
        .setColor(0x00c851)
        .setThumbnail(iconUrl)
        .addFields(
          { name: 'Nível', value: String(data.summonerLevel ?? '?'), inline: true },
          { name: 'Solo/Duo', value: `${data.solo?.tier ?? 'Unranked'} ${data.solo?.rank ?? ''}`.trim(), inline: true },
          { name: 'Flex', value: `${data.flex?.tier ?? 'Unranked'} ${data.flex?.rank ?? ''}`.trim(), inline: true },
        );

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`lol/verify/${sessionKey}`).setLabel('Verificar').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`lol/cancel/${sessionKey}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger),
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (e) {
      this.logger.error(`LoL verification error: ${e}`);
      await interaction.editReply('❌ Erro ao buscar conta. Tente novamente.');
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    }
  }

  @Button('lol/verify/:key')
  async onVerify(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferUpdate();
    const session = sessions.get(key);
    if (!session || session.userId !== interaction.user.id) return;

    try {
      const result = await this.riotService.verifyIcon(session.puuid, session.iconId);
      if (!result.verified) {
        const embed = new EmbedBuilder().setDescription('❌ O ícone de perfil não foi alterado. Verificação falhou.').setColor(0xff4444);
        await interaction.editReply({ embeds: [embed], components: [] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
      }

      try {
        await this.userService.createPlayer({ discordId: interaction.user.id, name: session.playerData.gameName ?? interaction.user.username } as any);
      } catch {}

      sessions.delete(key);
      const embed = new EmbedBuilder().setDescription('✅ Conta verificada e registrada com sucesso!').setColor(0x00c851);
      await interaction.editReply({ embeds: [embed], components: [] });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    } catch (e) {
      const embed = new EmbedBuilder().setDescription('❌ Não foi possível verificar a conta. Tente novamente.').setColor(0xff4444);
      await interaction.editReply({ embeds: [embed], components: [] });
    }
  }

  @Button('lol/cancel/:key')
  async onCancel(@Context() [interaction]: ButtonContext, @ComponentParam('key') key: string) {
    await interaction.deferUpdate();
    sessions.delete(key);
    const embed = new EmbedBuilder().setDescription('Verificação cancelada.').setColor(0xff4444);
    await interaction.editReply({ embeds: [embed], components: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
  }
}
