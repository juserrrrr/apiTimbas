import { DraftOrderType } from '@prisma/client';

export interface PickCoordinate {
  round: number;
  indexInRound: number;
  rosterIndex: number;
}

export function pickCoordinate(
  pickNumber: number,
  rosterCount: number,
  orderType: DraftOrderType,
): PickCoordinate {
  const round = Math.floor(pickNumber / rosterCount) + 1;
  const indexInRound = pickNumber % rosterCount;
  const reversed = orderType === DraftOrderType.SNAKE && round % 2 === 0;
  return {
    round,
    indexInRound,
    rosterIndex: reversed ? rosterCount - 1 - indexInRound : indexInRound,
  };
}

export function upcomingPicks(
  currentPickNumber: number,
  totalPicks: number,
  rosterCount: number,
  orderType: DraftOrderType,
  howMany: number,
): PickCoordinate[] {
  const picks: PickCoordinate[] = [];
  for (let offset = 0; offset < howMany; offset++) {
    const pickNumber = currentPickNumber + offset;
    if (pickNumber >= totalPicks) break;
    picks.push(pickCoordinate(pickNumber, rosterCount, orderType));
  }
  return picks;
}

export function roundRobinPairs(teamCount: number): Array<{ round: number; home: number; away: number }> {
  const indexes = Array.from({ length: teamCount }, (_, index) => index);
  if (indexes.length % 2 === 1) indexes.push(-1);

  const half = indexes.length / 2;
  const rounds = indexes.length - 1;
  const fixtures: Array<{ round: number; home: number; away: number }> = [];
  let rotation = indexes.slice(1);

  for (let round = 0; round < rounds; round++) {
    const lineup = [indexes[0], ...rotation];
    for (let pair = 0; pair < half; pair++) {
      const first = lineup[pair];
      const second = lineup[lineup.length - 1 - pair];
      if (first === -1 || second === -1) continue;
      const swap = round % 2 === 1;
      fixtures.push({ round: round + 1, home: swap ? second : first, away: swap ? first : second });
    }
    rotation = [rotation[rotation.length - 1], ...rotation.slice(0, -1)];
  }

  return fixtures;
}

export function nextMatchDates(from: Date, weekdays: number[], hour: number, count: number): Date[] {
  const allowed = [...new Set(weekdays)].sort((a, b) => a - b);
  if (allowed.length === 0) allowed.push(0, 3);

  const dates: Date[] = [];
  const cursor = new Date(from);
  cursor.setHours(hour, 0, 0, 0);
  if (cursor <= from) cursor.setDate(cursor.getDate() + 1);

  while (dates.length < count) {
    if (allowed.includes(cursor.getDay())) dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
