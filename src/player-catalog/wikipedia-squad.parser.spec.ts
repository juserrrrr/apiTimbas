import { parseSquadWikitext } from './wikipedia-squad.parser';

/// Os dois trechos abaixo são o formato real dos artigos: um no arranjo do
/// Flamengo (Players > First-team squad) e outro no do Bahia (Current squad >
/// First team). Se a Wikipédia mudar de template, é aqui que quebra primeiro.

const FLAMENGO = `
==Rivalries==
Nada aqui.

==Players==
===First-team squad===
{{Fs start}}
{{Fs player|no=1|nat=Argentina|pos=GK|name=[[Agustín Rossi (footballer)|Agustín Rossi]]}}
{{Fs player|no=3|nat=BRA|pos=DF|name=[[Léo Ortiz]]}}
{{Fs player|no=10|nat=BRA|pos=MF|name=[[Giorgian de Arrascaeta]]|other=[[Captain (association football)|captain]]}}
{{Fs end}}

===Out on loan===
{{Fs start}}
{{Fs player|no=|nat=BRA|pos=FW|name=[[Emprestado da Silva]]}}
{{Fs end}}

===Retired numbers===
{{Fs start}}
{{Fs player|no=12|nat=BRA|pos=|name=[[Torcida Rubro-Negra]]}}
{{Fs end}}

==Honours==
`;

const BAHIA = `
==Current squad==
===First team===
{{updated|16 July 2026}}
{{Fs start}}
{{Fs player|no=1|nat=BRA|pos=GK|name=Marcos Felipe}}
{{Fs player|no=5|nat=BRA|pos=MF|name=[[Fábio (footballer, born 1980)]]}}
{{Fs end}}

===Youth team===
{{Fs start}}
{{Fs player|no=40|nat=BRA|pos=FW|name=Moleque da Base}}
{{Fs end}}
`;

describe('parseSquadWikitext', () => {
  it('lê o elenco no arranjo com a seção de elenco por dentro', () => {
    const players = parseSquadWikitext(FLAMENGO);

    expect(players.map((player) => player.name)).toEqual([
      'Agustín Rossi',
      'Léo Ortiz',
      'Giorgian de Arrascaeta',
    ]);
    expect(players[0]).toEqual({
      name: 'Agustín Rossi',
      position: 'GK',
      nationality: 'Argentina',
      shirtNumber: 1,
    });
  });

  it('lê o elenco no arranjo com a seção de elenco por fora', () => {
    const players = parseSquadWikitext(BAHIA);

    expect(players.map((player) => player.name)).toEqual([
      'Marcos Felipe',
      'Fábio',
    ]);
    expect(players[1].position).toBe('MF');
  });

  it('deixa de fora emprestado, base e número aposentado', () => {
    const names = parseSquadWikitext(`${FLAMENGO}${BAHIA}`).map(
      (player) => player.name,
    );

    expect(names).not.toContain('Emprestado da Silva');
    expect(names).not.toContain('Torcida Rubro-Negra');
    expect(names).not.toContain('Moleque da Base');
  });

  it('não repete quem aparece em duas seções', () => {
    const twice = `${BAHIA}\n==First-team squad==\n{{Fs player|no=1|nat=BRA|pos=GK|name=Marcos Felipe}}`;
    const names = parseSquadWikitext(twice).map((player) => player.name);

    expect(names.filter((name) => name === 'Marcos Felipe')).toHaveLength(1);
  });

  it('não se perde no pipe de dentro do link nem no template aninhado', () => {
    const players = parseSquadWikitext(FLAMENGO);
    const captain = players.find(
      (player) => player.name === 'Giorgian de Arrascaeta',
    );

    expect(captain?.position).toBe('MF');
    expect(captain?.shirtNumber).toBe(10);
  });

  it('não inventa jogador em artigo sem elenco', () => {
    expect(parseSquadWikitext('==History==\nO clube nasceu em 1895.')).toEqual(
      [],
    );
  });
});
