import { parsePlayerLines, parseTeamLines } from './text-parser';

describe('parsePlayerLines', () => {
  it('lê uma lista com separador de ponto e vírgula', () => {
    const players = parsePlayerLines('Neymar;ATA;89;Santos\nAlisson;GOL;88;Liverpool');
    expect(players).toEqual([
      { name: 'Neymar', position: 'ATA', overall: 89, realTeam: 'Santos' },
      { name: 'Alisson', position: 'GOL', overall: 88, realTeam: 'Liverpool' },
    ]);
  });

  it('aceita uma lista só de nomes', () => {
    const players = parsePlayerLines('Caio\nRafa\nDuda');
    expect(players.map((player) => player.name)).toEqual(['Caio', 'Rafa', 'Duda']);
    expect(players.every((player) => player.overall === null)).toBe(true);
  });

  it('tira a numeração da camisa colada junto do nome', () => {
    expect(parsePlayerLines('10. Zico\n9) Careca')[0].name).toBe('Zico');
    expect(parsePlayerLines('10. Zico\n9) Careca')[1].name).toBe('Careca');
  });

  it('traduz a posição para o padrão do catálogo', () => {
    const players = parsePlayerLines('João\tGoalkeeper\nPedro\tCentre-Back\nLucas\tRight Winger');
    expect(players.map((player) => player.position)).toEqual(['GOL', 'ZAG', 'PD']);
  });

  it('ignora cabeçalho de planilha e linhas vazias', () => {
    const players = parsePlayerLines('Nome;Posição;Overall\n\nNeymar;ATA;89\n');
    expect(players).toHaveLength(1);
    expect(players[0].name).toBe('Neymar');
  });

  it('não repete o mesmo jogador', () => {
    expect(parsePlayerLines('Neymar\nNEYMAR\nneymar')).toHaveLength(1);
  });

  it('separa colunas coladas com espaços largos', () => {
    const players = parsePlayerLines('Endrick     ATA     82');
    expect(players[0]).toEqual({ name: 'Endrick', position: 'ATA', overall: 82, realTeam: null });
  });
});

describe('parseTeamLines', () => {
  it('lê nome e sigla', () => {
    expect(parseTeamLines('Flamengo;FLA\nPalmeiras;PAL')).toEqual([
      { name: 'Flamengo', shortName: 'FLA' },
      { name: 'Palmeiras', shortName: 'PAL' },
    ]);
  });

  it('aceita só o nome e tira a numeração', () => {
    expect(parseTeamLines('1. Botafogo\n2. Grêmio')).toEqual([
      { name: 'Botafogo', shortName: null },
      { name: 'Grêmio', shortName: null },
    ]);
  });

  it('não repete time', () => {
    expect(parseTeamLines('Santos\nSANTOS')).toHaveLength(1);
  });
});
