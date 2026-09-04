export interface FormationCandidateMatch {
  id: string;
  playedAt: Date;
  result: 'WIN' | 'DRAW' | 'LOSS';
  positions: string[];
}

export interface RatedPosition {
  position: string;
  appearances: number;
  ratingSum: number;
  ratedMatches: number;
  goals: number;
  assists: number;
  shots: number;
  passesCompleted: number;
  passesAttempted: number;
  tacklesCompleted: number;
  tacklesAttempted: number;
  saves: number;
}

export function rankPlayerPositions(positions: RatedPosition[]) {
  return positions
    .map((position) => ({
      position: position.position,
      appearances: position.appearances,
      averageRating: position.ratedMatches
        ? position.ratingSum / position.ratedMatches
        : null,
      goals: position.goals,
      assists: position.assists,
      shots: position.shots,
      shotConversion: position.shots
        ? (position.goals / position.shots) * 100
        : null,
      passesCompleted: position.passesCompleted,
      passAccuracy: position.passesAttempted
        ? (position.passesCompleted / position.passesAttempted) * 100
        : null,
      tacklesCompleted: position.tacklesCompleted,
      tackleAccuracy: position.tacklesAttempted
        ? (position.tacklesCompleted / position.tacklesAttempted) * 100
        : null,
      saves: position.saves,
    }))
    .sort(
      (a, b) =>
        Number(b.averageRating ?? -1) - Number(a.averageRating ?? -1) ||
        b.appearances - a.appearances,
    );
}

export function formationShape(positions: string[]) {
  const counts = { goalkeeper: 0, defense: 0, midfield: 0, attack: 0 };
  for (const value of positions) {
    const position = value.trim().toUpperCase();
    if (position === 'GK' || position === 'GOALKEEPER') counts.goalkeeper += 1;
    else if (/(CB|LB|RB|LWB|RWB|SW|DEFENDER|DEF)/.test(position))
      counts.defense += 1;
    else if (/(ST|CF|LW|RW|LF|RF|FORWARD|ATT)/.test(position))
      counts.attack += 1;
    else counts.midfield += 1;
  }
  return counts;
}

export function completeFormation(positions: string[]) {
  const shape = formationShape(positions);
  const outfield = shape.defense + shape.midfield + shape.attack;
  if (
    outfield !== 10 ||
    shape.defense < 3 ||
    shape.defense > 5 ||
    shape.midfield < 2 ||
    shape.midfield > 5 ||
    shape.attack < 1 ||
    shape.attack > 3
  )
    return null;
  return `${shape.defense}-${shape.midfield}-${shape.attack}`;
}

export function selectBestFormation(matches: FormationCandidateMatch[]) {
  const candidates = new Map<
    string,
    {
      formation: string;
      matches: number;
      wins: number;
      draws: number;
      latestAt: number;
    }
  >();
  for (const match of matches) {
    const formation = completeFormation(match.positions);
    if (!formation) continue;
    const row = candidates.get(formation) ?? {
      formation,
      matches: 0,
      wins: 0,
      draws: 0,
      latestAt: match.playedAt.getTime(),
    };
    row.matches += 1;
    row.wins += match.result === 'WIN' ? 1 : 0;
    row.draws += match.result === 'DRAW' ? 1 : 0;
    row.latestAt = Math.max(row.latestAt, match.playedAt.getTime());
    candidates.set(formation, row);
  }
  const selected = [...candidates.values()].sort((a, b) => {
    return (
      b.matches - a.matches ||
      b.wins - a.wins ||
      b.draws - a.draws ||
      b.latestAt - a.latestAt
    );
  })[0];
  if (!selected) return null;
  return {
    formation: selected.formation,
    matches: selected.matches,
    wins: selected.wins,
    draws: selected.draws,
    losses: selected.matches - selected.wins - selected.draws,
    pointsPerMatch: (selected.wins * 3 + selected.draws) / selected.matches,
  };
}
