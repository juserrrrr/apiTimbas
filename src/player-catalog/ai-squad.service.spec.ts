import { overallFromAttributes } from '../football/attributes';
import { marketValueFor } from '../football/market-value';
import { parseAiCompetition, parseAiSquad } from './ai-squad.service';

const answer = (players: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    teamName: 'Clube de Regatas do Flamengo',
    players,
    ...extra,
  });

describe('parseAiSquad', () => {
  it('lê o elenco com card e traduz a posição para o padrão do catálogo', () => {
    const parsed = parseAiSquad(
      answer([
        {
          shirtNumber: 1,
          name: 'Agustín Rossi',
          position: 'Goalkeeper',
          nationality: 'Argentina',
          birthDate: '1995-08-21',
          onLoan: false,
          fromYouth: false,
          confidence: 95,
          pace: 83,
          shooting: 81,
          passing: 76,
          dribbling: 84,
          defending: 53,
          physical: 85,
          overall: 79,
          note: 'Goleiro experiente, bom em pênalti.',
        },
      ]),
    );

    expect(parsed?.teamName).toBe('Clube de Regatas do Flamengo');
    expect(parsed?.players).toEqual([
      {
        shirtNumber: 1,
        name: 'Agustín Rossi',
        position: 'GOL',
        rawPosition: 'Goalkeeper',
        nationality: 'Argentina',
        birthDate: '1995-08-21',
        onLoan: false,
        fromYouth: false,
        confidence: 95,
        attributes: {
          pace: 83,
          shooting: 81,
          passing: 76,
          dribbling: 84,
          defending: 53,
          physical: 85,
        },
        overall: 79,
        price: marketValueFor(79),
        note: 'Goleiro experiente, bom em pênalti.',
      },
    ]);
  });

  it('calcula o overall pela posição quando o modelo esquece dele', () => {
    const parsed = parseAiSquad(
      answer([
        {
          name: 'Pedro',
          position: 'ATA',
          pace: 80,
          shooting: 85,
          passing: 70,
          dribbling: 80,
          defending: 40,
          physical: 78,
        },
      ]),
    );

    const player = parsed!.players[0];
    expect(player.overall).toBe(overallFromAttributes('ATA', player.attributes!));
    expect(player.price).toBe(marketValueFor(player.overall!));
  });

  it('deixa o card nulo quando falta algum dos seis atributos', () => {
    const parsed = parseAiSquad(
      answer([{ name: 'Pedro', position: 'ATA', pace: 80, shooting: 85, overall: 84 }]),
    );

    expect(parsed?.players[0]).toMatchObject({ attributes: null, overall: 84, price: marketValueFor(84) });
  });

  it('aceita o JSON embrulhado em cerca de código', () => {
    const parsed = parseAiSquad(
      '```json\n' + answer([{ name: 'Zico', position: 'MEI' }]) + '\n```',
    );
    expect(parsed?.players).toHaveLength(1);
  });

  it('descarta camisa, data e confiança fora do intervalo', () => {
    const parsed = parseAiSquad(
      answer([
        {
          shirtNumber: 140,
          name: 'Fulano',
          position: 'ZAG',
          birthDate: '21/08/1995',
          confidence: 'muito alta',
        },
      ]),
    );

    expect(parsed?.players[0]).toMatchObject({
      shirtNumber: null,
      birthDate: null,
      confidence: 0,
    });
  });

  it('não repete jogador nem aceita nome vazio', () => {
    const parsed = parseAiSquad(
      answer([
        { name: 'Pedro', position: 'ATA' },
        { name: 'pedro', position: 'ATA' },
        { name: '', position: 'ATA' },
        { position: 'GOL' },
      ]),
    );

    expect(parsed?.players.map((player) => player.name)).toEqual(['Pedro']);
  });

  it('devolve null quando não veio JSON com elenco', () => {
    expect(parseAiSquad('não sei responder isso')).toBeNull();
    expect(parseAiSquad('{"teamName":"Flamengo"}')).toBeNull();
  });

  it('marca o aviso de conhecimento defasado', () => {
    const parsed = parseAiSquad(
      answer([{ name: 'Pedro', position: 'ATA' }], {
        beyondKnowledge: true,
        notes: 'meu conhecimento vai até 2025',
      }),
    );

    expect(parsed?.beyondKnowledge).toBe(true);
    expect(parsed?.notes).toBe('meu conhecimento vai até 2025');
  });
});

describe('parseAiCompetition', () => {
  it('lê os clubes da competição', () => {
    const parsed = parseAiCompetition(
      JSON.stringify({
        competition: 'Campeonato Brasileiro Série A',
        season: '2026',
        country: 'Brasil',
        teams: [
          { name: 'Flamengo', shortName: 'fla', country: 'Brasil' },
          { name: 'Palmeiras', shortName: null, country: 'Brasil' },
        ],
        notes: '',
      }),
    );

    expect(parsed?.competition).toBe('Campeonato Brasileiro Série A');
    expect(parsed?.season).toBe('2026');
    expect(parsed?.teams).toEqual([
      { name: 'Flamengo', shortName: 'FLA', country: 'Brasil' },
      { name: 'Palmeiras', shortName: null, country: 'Brasil' },
    ]);
  });

  it('não repete clube e ignora nome vazio', () => {
    const parsed = parseAiCompetition(
      JSON.stringify({ teams: [{ name: 'Flamengo' }, { name: 'flamengo' }, { name: '' }] }),
    );
    expect(parsed?.teams.map((team) => team.name)).toEqual(['Flamengo']);
  });

  it('devolve null quando não veio lista de clubes', () => {
    expect(parseAiCompetition('desculpe, não sei')).toBeNull();
  });
});
