import { TournamentPhase } from '@prisma/client';
import {
  bracketSizeFor,
  buildDoubleElimination,
  buildRoundRobin,
  buildSingleElimination,
  distributeIntoGroups,
  seedSlots,
} from './bracket.builder';

describe('bracketSizeFor', () => {
  it('arredonda para a próxima potência de 2', () => {
    expect(bracketSizeFor(2)).toBe(2);
    expect(bracketSizeFor(5)).toBe(8);
    expect(bracketSizeFor(8)).toBe(8);
    expect(bracketSizeFor(9)).toBe(16);
  });
});

describe('seedSlots', () => {
  it('cruza o melhor com o pior em cada confronto', () => {
    expect(seedSlots(4)).toEqual([1, 4, 2, 3]);
    expect(seedSlots(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('faz cada confronto somar o mesmo total de cabeças', () => {
    const slots = seedSlots(8);
    for (let position = 0; position < 4; position++) {
      expect(slots[position * 2] + slots[position * 2 + 1]).toBe(9);
    }
  });

  it('nunca coloca os dois melhores na mesma metade', () => {
    const slots = seedSlots(16);
    expect(slots.slice(0, 8)).toContain(1);
    expect(slots.slice(8)).toContain(2);
  });
});

describe('buildSingleElimination', () => {
  it('gera n-1 partidas para uma chave cheia', () => {
    const plans = buildSingleElimination(8, false);
    expect(plans).toHaveLength(7);
    expect(plans.filter((plan) => plan.round === 1)).toHaveLength(4);
    expect(plans.filter((plan) => plan.round === 3)).toHaveLength(1);
  });

  it('encaminha o vencedor para a partida certa da rodada seguinte', () => {
    const plans = buildSingleElimination(4, false);
    const first = plans.find((plan) => plan.round === 1 && plan.position === 0)!;
    const second = plans.find((plan) => plan.round === 1 && plan.position === 1)!;
    expect(first.winnerTo).toEqual({ phase: TournamentPhase.WINNERS, round: 2, position: 0, slot: 'HOME' });
    expect(second.winnerTo).toEqual({ phase: TournamentPhase.WINNERS, round: 2, position: 0, slot: 'AWAY' });
  });

  it('deixa vagas livres quando o número de times não é potência de 2', () => {
    const plans = buildSingleElimination(5, false);
    const roundOne = plans.filter((plan) => plan.round === 1);
    const byes = roundOne.filter((plan) => plan.homeSeed! > 5 || plan.awaySeed! > 5);
    expect(byes).toHaveLength(3);
  });

  it('cria a disputa de terceiro alimentada pelas semifinais', () => {
    const plans = buildSingleElimination(4, true);
    const thirdPlace = plans.find((plan) => plan.phase === TournamentPhase.THIRD_PLACE);
    expect(thirdPlace).toBeDefined();
    const semis = plans.filter((plan) => plan.phase === TournamentPhase.WINNERS && plan.round === 1);
    expect(semis.map((semi) => semi.loserTo?.slot)).toEqual(['HOME', 'AWAY']);
  });
});

describe('buildDoubleElimination', () => {
  it('gera 2n-2 partidas contando a grande final', () => {
    expect(buildDoubleElimination(8)).toHaveLength(14);
    expect(buildDoubleElimination(16)).toHaveLength(30);
  });

  it('manda todo perdedor da chave superior para a inferior', () => {
    const plans = buildDoubleElimination(8);
    const winners = plans.filter((plan) => plan.phase === TournamentPhase.WINNERS);
    expect(winners.every((plan) => plan.loserTo?.phase === TournamentPhase.LOSERS)).toBe(true);
  });

  it('leva o campeão de cada chave para a grande final', () => {
    const plans = buildDoubleElimination(8);
    const winnersFinal = plans.find((plan) => plan.phase === TournamentPhase.WINNERS && plan.round === 3)!;
    const losersFinal = plans
      .filter((plan) => plan.phase === TournamentPhase.LOSERS)
      .sort((a, b) => b.round - a.round)[0];
    expect(winnersFinal.winnerTo).toMatchObject({ phase: TournamentPhase.GRAND_FINAL, slot: 'HOME' });
    expect(losersFinal.winnerTo).toMatchObject({ phase: TournamentPhase.GRAND_FINAL, slot: 'AWAY' });
  });

  it('não deixa nenhuma partida da chave inferior sem destino', () => {
    const plans = buildDoubleElimination(16).filter((plan) => plan.phase === TournamentPhase.LOSERS);
    expect(plans.every((plan) => plan.winnerTo !== undefined)).toBe(true);
  });
});

describe('buildRoundRobin', () => {
  it('faz todo mundo jogar contra todo mundo uma vez', () => {
    const plans = buildRoundRobin(6, 1, TournamentPhase.LEAGUE);
    expect(plans).toHaveLength(15);

    const pairs = new Set(plans.map((plan) => [plan.homeIndex, plan.awayIndex].sort().join('-')));
    expect(pairs.size).toBe(15);
  });

  it('dá folga para um time por rodada quando o número é ímpar', () => {
    const plans = buildRoundRobin(5, 1, TournamentPhase.LEAGUE);
    expect(plans).toHaveLength(10);
    for (let round = 1; round <= 5; round++) {
      expect(plans.filter((plan) => plan.round === round)).toHaveLength(2);
    }
  });

  it('inverte o mando de campo no returno', () => {
    const plans = buildRoundRobin(4, 2, TournamentPhase.LEAGUE);
    expect(plans).toHaveLength(12);

    const first = plans.find((plan) => plan.leg === 1)!;
    const second = plans.find(
      (plan) => plan.leg === 2 && plan.homeIndex === first.awayIndex && plan.awayIndex === first.homeIndex,
    );
    expect(second).toBeDefined();
  });
});

describe('distributeIntoGroups', () => {
  it('distribui os cabeças de chave em grupos diferentes', () => {
    const groups = distributeIntoGroups(8, 2);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toContain(0);
    expect(groups[1]).toContain(1);
  });

  it('mantém os grupos equilibrados', () => {
    const groups = distributeIntoGroups(12, 4);
    expect(groups.map((group) => group.length)).toEqual([3, 3, 3, 3]);
  });
});
