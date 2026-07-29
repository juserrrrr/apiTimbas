import { GameMode } from '@prisma/client';
import { generateLeagueEmbedText, buildMatchEmbed } from './embed.helper';

const baseOptions = {
  blueTeam: [],
  redTeam: [],
  matchFormat: 'Aleatório',
  onlineMode: 'Online',
};

describe('embed.helper', () => {
  describe('generateLeagueEmbedText', () => {
    it('deve mostrar a Fenda atual no modo Normal', () => {
      const text = generateLeagueEmbedText({ ...baseOptions, gameMode: GameMode.SUMMONERS_RIFT });

      expect(text).toContain("[League of Legends] - Summoner's Rift");
      expect(text).not.toContain('Howling Abyss');
    });

    it('deve mostrar o League Classic com a Fenda da Season 3', () => {
      const text = generateLeagueEmbedText({ ...baseOptions, gameMode: GameMode.LOL_CLASSIC });

      expect(text).toContain("[League Classic] - Summoner's Rift");
      expect(text).not.toContain('Howling Abyss');
    });

    it('deve distinguir o League Classic da Fenda atual, que usam o mesmo mapa', () => {
      const normal = generateLeagueEmbedText({ ...baseOptions, gameMode: GameMode.SUMMONERS_RIFT });
      const classic = generateLeagueEmbedText({ ...baseOptions, gameMode: GameMode.LOL_CLASSIC });

      expect(normal).not.toEqual(classic);
    });

    it('deve mostrar o Howling Abyss no ARAM', () => {
      const text = generateLeagueEmbedText({ ...baseOptions, gameMode: GameMode.ARAM });

      expect(text).toContain('[ARAM] - Howling Abyss');
      expect(text).not.toContain("Summoner's Rift");
    });

    it('deve usar a Fenda atual quando o modo não é informado', () => {
      const text = generateLeagueEmbedText(baseOptions);

      expect(text).toContain("[League of Legends] - Summoner's Rift");
    });

    it('não deve truncar o nome do mapa em nenhum modo', () => {
      for (const mode of Object.values(GameMode)) {
        const text = generateLeagueEmbedText({ ...baseOptions, gameMode: mode });
        const mapLine = text.split('\n')[2];

        expect(mapLine).toContain(mode === GameMode.ARAM ? 'Howling Abyss' : "Summoner's Rift");
      }
    });

    it('deve gerar uma linha por jogador do time', () => {
      const text = generateLeagueEmbedText({ ...baseOptions, playersPerTeam: 1 });

      // 5 linhas de cabeçalho + 1 em branco + 1 linha de confronto
      expect(text.split('\n').filter((l) => l.includes('< VS >'))).toHaveLength(1);
    });
  });

  describe('buildMatchEmbed', () => {
    it('deve repassar o modo de jogo para o texto do embed', () => {
      const embed = buildMatchEmbed({
        ...baseOptions,
        footerText: 'Aguardando jogadores... 0/2',
        gameMode: GameMode.ARAM,
        playersPerTeam: 1,
      });

      expect(embed.data.description).toContain('[ARAM] - Howling Abyss');
    });

    it('deve incluir o número da partida no rodapé quando houver matchId', () => {
      const embed = buildMatchEmbed({
        ...baseOptions,
        footerText: 'Partida finalizada!',
        matchId: 42,
      });

      expect(embed.data.footer?.text).toBe('Partida finalizada! · Partida #42');
    });

    it('deve montar o rodapé sem o número quando não houver matchId', () => {
      const embed = buildMatchEmbed({ ...baseOptions, footerText: 'Partida finalizada!' });

      expect(embed.data.footer?.text).toBe('Partida finalizada!');
    });
  });
});
