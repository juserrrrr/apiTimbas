const FORMATION_WINDOW = 25;

export interface FormationMatch {
  id: string;
  playedAt: Date;
  result: 'WIN' | 'DRAW' | 'LOSS';
  positions: string[];
}

export function selectPreferredFormation(matches: FormationMatch[]) {
  const groups = new Map<
    string,
    { formation: string; matches: FormationMatch[]; wins: number; draws: number }
  >();
  for (const match of matches.slice(0, FORMATION_WINDOW)) {
    const formation = formationFor(match.positions);
    const group = groups.get(formation) ?? { formation, matches: [], wins: 0, draws: 0 };
    group.matches.push(match);
    group.wins += match.result === 'WIN' ? 1 : 0;
    group.draws += match.result === 'DRAW' ? 1 : 0;
    groups.set(formation, group);
  }
  const selected = [...groups.values()].sort(
    (a, b) =>
      b.matches.length - a.matches.length ||
      b.wins - a.wins ||
      b.draws - a.draws ||
      b.matches[0].playedAt.getTime() - a.matches[0].playedAt.getTime(),
  )[0];
  if (!selected) return null;
  return {
    formation: selected.formation,
    matches: selected.matches.length,
    wins: selected.wins,
    draws: selected.draws,
    matchId: selected.matches[0].id,
  };
}

export function formationFor(positions: string[]) {
  const counts = { defense: 0, midfield: 0, attack: 0 };
  for (const value of positions) {
    const position = value.trim().toUpperCase();
    if (/(CB|LB|RB|LWB|RWB|SW|DEFENDER|DEF)/.test(position)) counts.defense += 1;
    else if (/(ST|CF|LW|RW|LF|RF|FORWARD|ATT)/.test(position)) counts.attack += 1;
    else if (position !== 'GK') counts.midfield += 1;
  }
  return `${counts.defense}-${counts.midfield}-${counts.attack}`;
}
