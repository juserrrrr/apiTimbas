import { TournamentFormat, TournamentPhase } from '@prisma/client';
import {
  bracketSizeFor,
  buildDoubleElimination,
  buildGroupStage,
  buildRoundRobin,
  buildSingleElimination,
  distributeIntoGroups,
  groupPlanIssue,
  orderGroupQualifiers,
  seedSlots,
  tournamentPlanIssue,
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

describe('tournamentPlanIssue', () => {
  const plan = { teamCount: 8, groupCount: 2, advancePerGroup: 2, legs: 1, thirdPlace: false };

  it('aceita o plano coerente de cada formato', () => {
    expect(tournamentPlanIssue(TournamentFormat.SINGLE_ELIMINATION, plan)).toBeNull();
    expect(tournamentPlanIssue(TournamentFormat.DOUBLE_ELIMINATION, plan)).toBeNull();
    expect(tournamentPlanIssue(TournamentFormat.ROUND_ROBIN, { ...plan, legs: 2 })).toBeNull();
    expect(tournamentPlanIssue(TournamentFormat.GROUPS_KNOCKOUT, { ...plan, legs: 2 })).toBeNull();
  });

  it('recusa campeonato sem gente', () => {
    expect(tournamentPlanIssue(TournamentFormat.SINGLE_ELIMINATION, { ...plan, teamCount: 1 })).toContain(
      'ao menos 2 times',
    );
  });

  it('recusa eliminação dupla com menos de 4', () => {
    expect(tournamentPlanIssue(TournamentFormat.DOUBLE_ELIMINATION, { ...plan, teamCount: 3 })).toContain(
      'ao menos 4 times',
    );
  });

  it('recusa ida e volta em mata-mata, porque a chave ignora isso', () => {
    expect(tournamentPlanIssue(TournamentFormat.SINGLE_ELIMINATION, { ...plan, legs: 2 })).toContain('Ida e volta');
    expect(tournamentPlanIssue(TournamentFormat.DOUBLE_ELIMINATION, { ...plan, legs: 2 })).toContain('Ida e volta');
  });

  it('recusa disputa de terceiro onde ela não existe', () => {
    expect(tournamentPlanIssue(TournamentFormat.ROUND_ROBIN, { ...plan, thirdPlace: true })).toContain(
      'Pontos corridos',
    );
    expect(
      tournamentPlanIssue(TournamentFormat.SINGLE_ELIMINATION, { ...plan, teamCount: 3, thirdPlace: true }),
    ).toContain('ao menos 4 times');
  });

  it('leva a regra de grupos para o formato de grupos', () => {
    expect(tournamentPlanIssue(TournamentFormat.GROUPS_KNOCKOUT, { ...plan, teamCount: 7 })).toContain(
      'grupos do mesmo tamanho',
    );
  });
});

describe('groupPlanIssue', () => {
  it('aceita a combinação que fecha grupos iguais e não passa todo mundo', () => {
    expect(groupPlanIssue(16, 4, 2)).toBeNull();
    expect(groupPlanIssue(12, 3, 3)).toBeNull();
    expect(groupPlanIssue(16, 8, 1)).toBeNull();
  });

  it('recusa grupo que não fecha dois times', () => {
    expect(groupPlanIssue(6, 4, 1)).toContain('ao menos 8 times');
  });

  it('recusa grupos de tamanhos diferentes e sugere os totais que servem', () => {
    expect(groupPlanIssue(10, 3, 2)).toContain('9 ou 12 times');
    expect(groupPlanIssue(7, 2, 1)).toContain('6 ou 8 times');
  });

  it('recusa classificar o grupo inteiro', () => {
    expect(groupPlanIssue(8, 4, 2)).toContain('no máximo 1 por grupo');
    expect(groupPlanIssue(12, 4, 3)).toContain('no máximo 2 por grupo');
  });

  it('recusa menos de 2 grupos ou nenhum classificado', () => {
    expect(groupPlanIssue(8, 1, 2)).toContain('ao menos 2 grupos');
    expect(groupPlanIssue(8, 2, 0)).toContain('ao menos 1 time');
  });
});

describe('buildGroupStage', () => {
  it('não repete a mesma posição entre grupos na mesma rodada', () => {
    const plans = buildGroupStage([4, 4, 4], 1);
    const keys = plans.map((plan) => `${plan.round}-${plan.position}-${plan.leg}`);
    expect(new Set(keys).size).toBe(plans.length);
  });

  it('mantém a chave única com grupos de tamanhos diferentes e turno e returno', () => {
    const plans = buildGroupStage([5, 4, 4, 3], 2);
    const keys = plans.map((plan) => `${plan.round}-${plan.position}-${plan.leg}`);
    expect(new Set(keys).size).toBe(plans.length);
  });

  it('faz todo mundo do grupo jogar entre si e identifica o grupo no rótulo', () => {
    const plans = buildGroupStage([4, 4], 1);
    expect(plans.filter((plan) => plan.groupOrder === 0)).toHaveLength(6);
    expect(plans.filter((plan) => plan.groupOrder === 1)).toHaveLength(6);
    expect(plans[0].label).toContain('Grupo A');
    expect(plans.at(-1)!.label).toContain('Grupo B');
  });
});

describe('orderGroupQualifiers', () => {
  const openers = (qualifiers: ReturnType<typeof orderGroupQualifiers>) => {
    const slots = seedSlots(bracketSizeFor(qualifiers.length));
    const pairs = [];
    for (let slot = 0; slot < slots.length; slot += 2) {
      pairs.push([qualifiers[slots[slot] - 1], qualifiers[slots[slot + 1] - 1]]);
    }
    return pairs;
  };

  it('cruza o líder de um grupo com o segundo de outro', () => {
    const qualifiers = orderGroupQualifiers([['a1', 'a2'], ['b1', 'b2']], 2);
    expect(qualifiers.map((entry) => entry.teamId)).toEqual(['a1', 'b1', 'a2', 'b2']);
    expect(openers(qualifiers).map((pair) => pair.map((entry) => entry?.teamId))).toEqual([
      ['a1', 'b2'],
      ['b1', 'a2'],
    ]);
  });

  it('classifica primeiro, segundo e terceiro de cada grupo', () => {
    const qualifiers = orderGroupQualifiers(
      [
        ['a1', 'a2', 'a3', 'a4'],
        ['b1', 'b2', 'b3', 'b4'],
        ['c1', 'c2', 'c3', 'c4'],
      ],
      3,
    );
    expect(qualifiers).toHaveLength(9);
    expect(qualifiers.slice(0, 3).map((entry) => entry.teamId)).toEqual(['a1', 'b1', 'c1']);
    expect(qualifiers.filter((entry) => entry.place === 2).map((entry) => entry.teamId)).toEqual([
      'a3',
      'b3',
      'c3',
    ]);
  });

  it('reproduz o cruzamento histÃ³rico das quartas com quatro grupos', () => {
    const qualifiers = orderGroupQualifiers(
      [
        ['a1', 'a2'],
        ['b1', 'b2'],
        ['c1', 'c2'],
        ['d1', 'd2'],
      ],
      2,
    );

    expect(openers(qualifiers).map((pair) => pair.map((entry) => entry?.teamId))).toEqual([
      ['a1', 'b2'],
      ['d1', 'c2'],
      ['b1', 'a2'],
      ['c1', 'd2'],
    ]);
  });

  it('nunca abre o mata-mata com dois times do mesmo grupo', () => {
    for (const groupCount of [2, 3, 4, 5, 6, 8]) {
      for (const advancePerGroup of [1, 2, 3, 4]) {
        const standings = Array.from({ length: groupCount }, (_, group) =>
          Array.from({ length: 4 }, (_, place) => `g${group}p${place}`),
        );
        const qualifiers = orderGroupQualifiers(standings, advancePerGroup);
        for (const [home, away] of openers(qualifiers)) {
          if (!home || !away) continue;
          expect(home.groupIndex).not.toBe(away.groupIndex);
        }
      }
    }
  });

  it('ignora colocações que o grupo não tem', () => {
    const qualifiers = orderGroupQualifiers([['a1', 'a2'], ['b1']], 2);
    expect(qualifiers.map((entry) => entry.teamId)).toEqual(['a1', 'b1', 'a2']);
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
