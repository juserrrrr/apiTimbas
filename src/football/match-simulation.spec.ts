import { TacticIntensity, TacticMentality } from '@prisma/client';
import { SimPlayer, SimSide, autoLineup, lineOf, playerStrength, simulateMatch } from './match-simulation';

const FORMATION: Array<[string, number]> = [
  ['GOL', 1],
  ['ZAG', 2],
  ['LD', 1],
  ['LE', 1],
  ['VOL', 1],
  ['MC', 2],
  ['MEI', 1],
  ['PE', 1],
  ['ATA', 1],
];

function squad(prefix: string, level: number): SimPlayer[] {
  const players: SimPlayer[] = [];
  for (const [position, count] of FORMATION) {
    for (let index = 0; index < count; index++) {
      players.push({
        id: `${prefix}-${position}-${index}`,
        position,
        overall: level,
        pace: level,
        shooting: level,
        passing: level,
        dribbling: level,
        defending: level,
        physical: level,
        form: 0,
      });
    }
  }
  return players;
}

function side(players: SimPlayer[], overrides: Partial<SimSide> = {}): SimSide {
  return {
    players,
    mentality: TacticMentality.BALANCED,
    pressing: TacticIntensity.MEDIUM,
    tempo: TacticIntensity.MEDIUM,
    ...overrides,
  };
}

/// Média de gols em muitas partidas, usada para comparar cenários sem depender
/// de um sorteio específico.
function average(homeSide: SimSide, awaySide: SimSide, runs = 400) {
  let home = 0;
  let away = 0;
  for (let index = 0; index < runs; index++) {
    const result = simulateMatch(homeSide, awaySide, `seed-${index}`);
    home += result.homeScore;
    away += result.awayScore;
  }
  return { home: home / runs, away: away / runs };
}

describe('lineOf', () => {
  it('agrupa as posições em goleiro, defesa, meio e ataque', () => {
    expect(lineOf('GOL')).toBe('GK');
    expect(lineOf('LD')).toBe('DEF');
    expect(lineOf('MEI')).toBe('MID');
    expect(lineOf('ATA')).toBe('ATT');
  });

  it('joga posição desconhecida no meio', () => {
    expect(lineOf('QUALQUER')).toBe('MID');
  });
});

describe('playerStrength', () => {
  it('usa o overall quando o jogador não tem atributos', () => {
    const player = { ...squad('x', 70)[0], pace: null, shooting: null, passing: null, dribbling: null, defending: null, physical: null };
    expect(playerStrength(player, 'DEF')).toBe(70);
  });

  it('soma a forma ao rendimento', () => {
    const player = squad('x', 70)[0];
    expect(playerStrength({ ...player, form: 3 }, 'DEF')).toBeGreaterThan(playerStrength(player, 'DEF'));
  });
});

describe('autoLineup', () => {
  it('escala um goleiro e completa até o tamanho pedido', () => {
    const chosen = autoLineup(squad('a', 70), 11);
    expect(chosen).toHaveLength(11);
    expect(chosen.filter((player) => lineOf(player.position) === 'GK')).toHaveLength(1);
    expect(new Set(chosen.map((player) => player.id)).size).toBe(11);
  });

  it('prefere quem tem overall maior', () => {
    const players = squad('a', 60);
    const star = { ...players[players.length - 1], id: 'estrela', overall: 95 };
    const chosen = autoLineup([...players.slice(0, 8), star], 9);
    expect(chosen.map((player) => player.id)).toContain('estrela');
  });

  it('devolve o que tem quando o elenco é curto', () => {
    expect(autoLineup(squad('a', 70).slice(0, 5), 11)).toHaveLength(5);
  });
});

describe('simulateMatch', () => {
  it('devolve o mesmo resultado para a mesma semente', () => {
    const first = simulateMatch(side(squad('a', 75)), side(squad('b', 75)), 'partida-1');
    const second = simulateMatch(side(squad('a', 75)), side(squad('b', 75)), 'partida-1');
    expect(second).toEqual(first);
  });

  it('dá nota para cada titular dos dois lados', () => {
    const result = simulateMatch(side(squad('a', 75)), side(squad('b', 75)), 'partida-2');
    expect(result.performances).toHaveLength(22);
    for (const performance of result.performances) {
      expect(performance.rating).toBeGreaterThanOrEqual(3);
      expect(performance.rating).toBeLessThanOrEqual(10);
    }
  });

  it('só credita gol para quem estava em campo, e a soma fecha com o placar', () => {
    for (let index = 0; index < 50; index++) {
      const home = squad('a', 80);
      const away = squad('b', 68);
      const result = simulateMatch(side(home), side(away), `conta-${index}`);
      const homeGoals = result.performances
        .filter((performance) => performance.playerId.startsWith('a-'))
        .reduce((sum, performance) => sum + performance.goals, 0);
      const awayGoals = result.performances
        .filter((performance) => performance.playerId.startsWith('b-'))
        .reduce((sum, performance) => sum + performance.goals, 0);

      expect(homeGoals).toBe(result.homeScore);
      expect(awayGoals).toBe(result.awayScore);
    }
  });

  it('não deixa goleiro marcar gol', () => {
    for (let index = 0; index < 100; index++) {
      const result = simulateMatch(side(squad('a', 85)), side(squad('b', 60)), `gol-${index}`);
      const keeper = result.performances.find((performance) => performance.playerId.includes('GOL'));
      expect(keeper!.goals).toBe(0);
    }
  });

  it('faz o time melhor marcar mais no longo prazo', () => {
    const strong = average(side(squad('a', 85)), side(squad('b', 62)));
    expect(strong.home).toBeGreaterThan(strong.away * 1.5);
  });

  it('dá vantagem de casa para times iguais', () => {
    const balanced = average(side(squad('a', 75)), side(squad('b', 75)));
    expect(balanced.home).toBeGreaterThan(balanced.away);
  });

  it('postura ofensiva marca mais e leva mais', () => {
    const attacking = average(
      side(squad('a', 75), { mentality: TacticMentality.ATTACKING }),
      side(squad('b', 75)),
    );
    const defensive = average(
      side(squad('a', 75), { mentality: TacticMentality.DEFENSIVE }),
      side(squad('b', 75)),
    );

    expect(attacking.home).toBeGreaterThan(defensive.home);
    expect(attacking.away).toBeGreaterThan(defensive.away);
  });

  it('escalação sem atacante rende menos que a com atacante', () => {
    const noStriker = squad('a', 75).filter((player) => lineOf(player.position) !== 'ATT');
    const withStriker = average(side(squad('a', 75)), side(squad('b', 75)));
    const without = average(side(noStriker), side(squad('b', 75)));
    expect(without.home).toBeLessThan(withStriker.home);
  });

  it('mantém a posse somando 100', () => {
    const result = simulateMatch(side(squad('a', 80)), side(squad('b', 70)), 'posse');
    expect(result.homePossession).toBeGreaterThan(50);
    expect(result.homePossession).toBeLessThan(100);
  });
});
