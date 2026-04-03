import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export function buildOfflineMatchButtons(
  key: string,
  started: boolean,
  matchFormatValue: number,
  playerCount: number,
  finished: boolean,
  playersPerTeam = 5,
): ActionRowBuilder<ButtonBuilder>[] {
  const maxPlayers = playersPerTeam * 2;
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (!started) {
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`cm/join/${key}`).setLabel('Entrar').setStyle(ButtonStyle.Success).setEmoji('✅').setDisabled(finished || playerCount >= maxPlayers),
      new ButtonBuilder().setCustomId(`cm/leave/${key}`).setLabel('Sair').setStyle(ButtonStyle.Danger).setEmoji('🚪').setDisabled(finished),
      new ButtonBuilder().setCustomId(`cm/count/${key}`).setLabel(`Confirmados: ${playerCount}/${maxPlayers}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    );
    rows.push(row1);

    const row2 = new ActionRowBuilder<ButtonBuilder>();
    if (matchFormatValue === 0 || matchFormatValue === 3) {
      row2.addComponents(new ButtonBuilder().setCustomId(`cm/draw/${key}`).setLabel('Sortear').setStyle(ButtonStyle.Primary).setEmoji('🎲').setDisabled(playerCount < maxPlayers || finished));
    } else if (matchFormatValue === 1) {
      row2.addComponents(new ButtonBuilder().setCustomId(`cm/switch/${key}`).setLabel('Trocar Lado').setStyle(ButtonStyle.Primary).setEmoji('🔄').setDisabled(playerCount !== maxPlayers || finished));
    }
    row2.addComponents(
      new ButtonBuilder().setCustomId(`cm/start/${key}`).setLabel('Iniciar').setStyle(ButtonStyle.Success).setEmoji('▶').setDisabled(playerCount !== maxPlayers || finished),
      new ButtonBuilder().setCustomId(`cm/finish/${key}`).setLabel('Finalizar').setStyle(ButtonStyle.Danger).setEmoji('🏁').setDisabled(true),
    );
    if (row2.components.length) rows.push(row2);
  } else {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`cm/rejoin/${key}`).setLabel('Voltar para a Sala').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
      new ButtonBuilder().setCustomId(`cm/finish/${key}`).setLabel('Finalizar').setStyle(ButtonStyle.Danger).setEmoji('🏁').setDisabled(finished),
    );
    rows.push(row);
  }

  return rows;
}

export function buildOnlineLobbyButtons(
  lobbyId: number | string,
  started: boolean,
  finished: boolean,
  isLivre: boolean,
): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ol/join/${lobbyId}`).setLabel('Entrar').setStyle(ButtonStyle.Success).setEmoji('✅').setDisabled(started || finished),
    new ButtonBuilder().setCustomId(`ol/leave/${lobbyId}`).setLabel('Sair').setStyle(ButtonStyle.Danger).setEmoji('🚪').setDisabled(started || finished),
    new ButtonBuilder().setCustomId(`ol/draw/${lobbyId}`).setLabel('Sortear').setStyle(ButtonStyle.Primary).setEmoji('🎲').setDisabled(started || finished || isLivre),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ol/start/${lobbyId}`).setLabel('Iniciar').setStyle(ButtonStyle.Success).setEmoji('▶').setDisabled(started || finished),
    new ButtonBuilder().setCustomId(`ol/finish/${lobbyId}`).setLabel('Finalizar').setStyle(ButtonStyle.Danger).setEmoji('🏁').setDisabled(finished),
  );
  if (started && !finished) {
    row2.addComponents(
      new ButtonBuilder().setCustomId(`ol/move/${lobbyId}`).setLabel('Ir para a sala').setStyle(ButtonStyle.Primary).setEmoji('🎧')
    );
  }
  return [row1, row2];
}
