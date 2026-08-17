import { MatchSlot, TournamentPhase } from '@prisma/client';

export interface MatchRef {
  phase: TournamentPhase;
  round: number;
  position: number;
  slot: MatchSlot;
}

export interface MatchPlan {
  phase: TournamentPhase;
  round: number;
  position: number;
  leg: number;
  label: string;
  groupOrder?: number;
  homeSeed?: number;
  awaySeed?: number;
  homeIndex?: number;
  awayIndex?: number;
  winnerTo?: MatchRef;
  loserTo?: MatchRef;
}

export function bracketSizeFor(teamCount: number): number {
  let size = 2;
  while (size < teamCount) size *= 2;
  return size;
}

export function seedSlots(size: number): number[] {
  let slots = [1, 2];
  while (slots.length < size) {
    const mirror = slots.length * 2 + 1;
    const next: number[] = [];
    for (const seed of slots) next.push(seed, mirror - seed);
    slots = next;
  }
  return slots;
}

export function knockoutRoundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinal';
  if (fromEnd === 2) return 'Quartas de final';
  if (fromEnd === 3) return 'Oitavas de final';
  return `${2 ** (fromEnd + 1)}ª de final`;
}

export function buildSingleElimination(teamCount: number, thirdPlace: boolean): MatchPlan[] {
  const size = bracketSizeFor(teamCount);
  const totalRounds = Math.log2(size);
  const slots = seedSlots(size);
  const plans: MatchPlan[] = [];

  for (let round = 1; round <= totalRounds; round++) {
    const matches = size / 2 ** round;
    for (let position = 0; position < matches; position++) {
      const plan: MatchPlan = {
        phase: TournamentPhase.WINNERS,
        round,
        position,
        leg: 1,
        label: knockoutRoundLabel(round, totalRounds),
      };

      if (round === 1) {
        plan.homeSeed = slots[position * 2];
        plan.awaySeed = slots[position * 2 + 1];
      }
      if (round < totalRounds) {
        plan.winnerTo = {
          phase: TournamentPhase.WINNERS,
          round: round + 1,
          position: Math.floor(position / 2),
          slot: position % 2 === 0 ? MatchSlot.HOME : MatchSlot.AWAY,
        };
      }
      if (thirdPlace && round === totalRounds - 1) {
        plan.loserTo = {
          phase: TournamentPhase.THIRD_PLACE,
          round: 1,
          position: 0,
          slot: position === 0 ? MatchSlot.HOME : MatchSlot.AWAY,
        };
      }
      plans.push(plan);
    }
  }

  if (thirdPlace && totalRounds >= 2) {
    plans.push({
      phase: TournamentPhase.THIRD_PLACE,
      round: 1,
      position: 0,
      leg: 1,
      label: 'Disputa de 3º lugar',
    });
  }

  return plans;
}

export function buildDoubleElimination(teamCount: number): MatchPlan[] {
  const size = bracketSizeFor(teamCount);
  const winnerRounds = Math.log2(size);
  const loserRounds = Math.max(0, 2 * (winnerRounds - 1));
  const slots = seedSlots(size);
  const plans: MatchPlan[] = [];

  const loserRoundSize = (round: number) => size / 2 ** (Math.ceil(round / 2) + 1);

  for (let round = 1; round <= winnerRounds; round++) {
    const matches = size / 2 ** round;
    for (let position = 0; position < matches; position++) {
      const plan: MatchPlan = {
        phase: TournamentPhase.WINNERS,
        round,
        position,
        leg: 1,
        label: `Chave dos vencedores · ${knockoutRoundLabel(round, winnerRounds)}`,
      };
      if (round === 1) {
        plan.homeSeed = slots[position * 2];
        plan.awaySeed = slots[position * 2 + 1];
      }
      plan.winnerTo =
        round < winnerRounds
          ? {
              phase: TournamentPhase.WINNERS,
              round: round + 1,
              position: Math.floor(position / 2),
              slot: position % 2 === 0 ? MatchSlot.HOME : MatchSlot.AWAY,
            }
          : { phase: TournamentPhase.GRAND_FINAL, round: 1, position: 0, slot: MatchSlot.HOME };

      if (loserRounds > 0) {
        plan.loserTo =
          round === 1
            ? {
                phase: TournamentPhase.LOSERS,
                round: 1,
                position: Math.floor(position / 2),
                slot: position % 2 === 0 ? MatchSlot.HOME : MatchSlot.AWAY,
              }
            : {
                phase: TournamentPhase.LOSERS,
                round: 2 * (round - 1),
                position: reversePosition(position, loserRoundSize(2 * (round - 1))),
                slot: MatchSlot.AWAY,
              };
      }
      plans.push(plan);
    }
  }

  for (let round = 1; round <= loserRounds; round++) {
    const matches = loserRoundSize(round);
    for (let position = 0; position < matches; position++) {
      const isLast = round === loserRounds;
      plans.push({
        phase: TournamentPhase.LOSERS,
        round,
        position,
        leg: 1,
        label: isLast ? 'Chave dos perdedores · Final' : `Chave dos perdedores · Rodada ${round}`,
        winnerTo: isLast
          ? { phase: TournamentPhase.GRAND_FINAL, round: 1, position: 0, slot: MatchSlot.AWAY }
          : {
              phase: TournamentPhase.LOSERS,
              round: round + 1,
              position: round % 2 === 1 ? position : Math.floor(position / 2),
              slot:
                round % 2 === 1
                  ? MatchSlot.HOME
                  : position % 2 === 0
                    ? MatchSlot.HOME
                    : MatchSlot.AWAY,
            },
      });
    }
  }

  plans.push({
    phase: TournamentPhase.GRAND_FINAL,
    round: 1,
    position: 0,
    leg: 1,
    label: 'Grande final',
  });

  return plans;
}

export function buildRoundRobin(
  teamCount: number,
  legs: number,
  phase: TournamentPhase,
  groupOrder?: number,
): MatchPlan[] {
  const indexes = Array.from({ length: teamCount }, (_, index) => index);
  if (indexes.length % 2 === 1) indexes.push(-1);

  const half = indexes.length / 2;
  const roundsPerLeg = indexes.length - 1;
  const plans: MatchPlan[] = [];
  let rotation = indexes.slice(1);

  for (let round = 0; round < roundsPerLeg; round++) {
    const lineup = [indexes[0], ...rotation];
    let position = 0;

    for (let pair = 0; pair < half; pair++) {
      const home = lineup[pair];
      const away = lineup[lineup.length - 1 - pair];
      if (home === -1 || away === -1) continue;

      const flip = round % 2 === 1;
      for (let leg = 1; leg <= legs; leg++) {
        const secondLeg = leg === 2;
        const homeIndex = flip !== secondLeg ? away : home;
        const awayIndex = flip !== secondLeg ? home : away;
        plans.push({
          phase,
          round: round + 1 + (leg - 1) * roundsPerLeg,
          position,
          leg,
          groupOrder,
          label: legs > 1 ? `Rodada ${round + 1} (${leg === 1 ? 'ida' : 'volta'})` : `Rodada ${round + 1}`,
          homeIndex,
          awayIndex,
        });
      }
      position++;
    }

    rotation = [rotation[rotation.length - 1], ...rotation.slice(0, -1)];
  }

  return plans;
}

export function distributeIntoGroups(teamCount: number, groupCount: number): number[][] {
  const groups: number[][] = Array.from({ length: groupCount }, () => []);
  for (let seed = 0; seed < teamCount; seed++) {
    const row = Math.floor(seed / groupCount);
    const column = row % 2 === 0 ? seed % groupCount : groupCount - 1 - (seed % groupCount);
    groups[column].push(seed);
  }
  return groups;
}

function reversePosition(position: number, size: number): number {
  return size > 0 ? (size - 1 - position + size) % size : 0;
}
