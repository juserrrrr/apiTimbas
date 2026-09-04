const WINDOW_SIZE = 15;

export interface PlayerMatchSnapshot {
  position: string | null;
  rating: number | null;
  goals: number;
  assists: number;
  shots: number | null;
  passesAttempted: number | null;
  passesCompleted: number | null;
  tacklesAttempted: number | null;
  tacklesCompleted: number | null;
  saves: number | null;
  manOfTheMatch: boolean | null;
}

type Totals = {
  appearances: number;
  ratedMatches: number;
  ratingSum: number;
  goals: number;
  assists: number;
  shots: number;
  passesAttempted: number;
  passesCompleted: number;
  tacklesAttempted: number;
  tacklesCompleted: number;
  saves: number;
  mvps: number;
};

export function analyseRecentPlayerMatches(matches: PlayerMatchSnapshot[]) {
  const recentMatches = matches.slice(0, WINDOW_SIZE);
  const totals = emptyTotals();
  const positions = new Map<string, Totals>();

  for (const match of recentMatches) {
    add(totals, match);
    const position = normalizePosition(match.position);
    if (!position) continue;
    const positionTotals = positions.get(position) ?? emptyTotals();
    add(positionTotals, match);
    positions.set(position, positionTotals);
  }

  const positionAnalysis = [...positions.entries()]
    .map(([position, value]) => ({ position, ...summary(value) }))
    .sort(
      (a, b) =>
        b.appearances - a.appearances || a.position.localeCompare(b.position),
    );
  const summaryTotals = summary(totals);
  const primaryPosition = positionAnalysis[0]?.position ?? null;

  return {
    windowSize: WINDOW_SIZE,
    matchesAvailable: recentMatches.length,
    primaryPosition,
    positionAnalysis,
    ...summaryTotals,
    strengths: insights(summaryTotals, primaryPosition, 'strength'),
    improvements: insights(summaryTotals, primaryPosition, 'improvement'),
  };
}

function emptyTotals(): Totals {
  return {
    appearances: 0,
    ratedMatches: 0,
    ratingSum: 0,
    goals: 0,
    assists: 0,
    shots: 0,
    passesAttempted: 0,
    passesCompleted: 0,
    tacklesAttempted: 0,
    tacklesCompleted: 0,
    saves: 0,
    mvps: 0,
  };
}

function add(totals: Totals, match: PlayerMatchSnapshot) {
  totals.appearances += 1;
  totals.ratedMatches += match.rating === null ? 0 : 1;
  totals.ratingSum += match.rating ?? 0;
  totals.goals += match.goals;
  totals.assists += match.assists;
  totals.shots += match.shots ?? 0;
  totals.passesAttempted += match.passesAttempted ?? 0;
  totals.passesCompleted += match.passesCompleted ?? 0;
  totals.tacklesAttempted += match.tacklesAttempted ?? 0;
  totals.tacklesCompleted += match.tacklesCompleted ?? 0;
  totals.saves += match.saves ?? 0;
  totals.mvps += match.manOfTheMatch ? 1 : 0;
}

function summary(totals: Totals) {
  return {
    appearances: totals.appearances,
    averageRating: totals.ratedMatches
      ? totals.ratingSum / totals.ratedMatches
      : null,
    goals: totals.goals,
    assists: totals.assists,
    goalContributions: totals.goals + totals.assists,
    shots: totals.shots,
    shotConversion: totals.shots ? (totals.goals / totals.shots) * 100 : null,
    passesAttempted: totals.passesAttempted,
    passesCompleted: totals.passesCompleted,
    passAccuracy: totals.passesAttempted
      ? (totals.passesCompleted / totals.passesAttempted) * 100
      : null,
    tacklesAttempted: totals.tacklesAttempted,
    tacklesCompleted: totals.tacklesCompleted,
    tackleAccuracy: totals.tacklesAttempted
      ? (totals.tacklesCompleted / totals.tacklesAttempted) * 100
      : null,
    saves: totals.saves,
    mvps: totals.mvps,
  };
}

function normalizePosition(position: string | null) {
  const value = position?.trim().toUpperCase();
  return value || null;
}

function role(position: string | null) {
  if (!position) return 'outfield';
  if (position === 'GK') return 'goalkeeper';
  if (/(CB|LB|RB|LWB|RWB|SW|DEF)/.test(position)) return 'defender';
  if (/(ST|CF|LW|RW|LF|RF|ATT|FOR)/.test(position)) return 'forward';
  return 'midfielder';
}

function insights(
  values: ReturnType<typeof summary>,
  primaryPosition: string | null,
  kind: 'strength' | 'improvement',
) {
  if (values.appearances < 3) return [];
  const playerRole = role(primaryPosition);
  const result: Array<{ metric: string; message: string }> = [];
  const add = (condition: boolean, metric: string, message: string) => {
    if (condition && result.length < 3) result.push({ metric, message });
  };

  if (kind === 'strength') {
    add(
      (values.averageRating ?? 0) >= 7,
      'Nota média',
      'Mantém uma nota média forte nesta janela.',
    );
    add(
      (values.passAccuracy ?? 0) >= 80 && values.passesCompleted >= 10,
      'Passe',
      'Tem boa segurança no passe quando participa da construção.',
    );
    add(
      values.goalContributions >= Math.max(2, values.appearances / 2),
      'Participação em gol',
      'Participa diretamente dos gols do time com frequência.',
    );
    add(
      values.tackleAccuracy !== null &&
        values.tackleAccuracy >= 65 &&
        values.tacklesCompleted >= 3,
      'Desarme',
      'Recupera a bola com boa eficiência nos duelos tentados.',
    );
    add(
      playerRole === 'goalkeeper' && values.saves >= values.appearances * 2,
      'Defesas',
      'Sustenta o time com bom volume de defesas.',
    );
  } else {
    add(
      (values.averageRating ?? 10) < 6.5,
      'Nota média',
      'Busque ações simples e consistentes para elevar a nota média.',
    );
    add(
      playerRole === 'forward' &&
        values.shots >= 4 &&
        (values.shotConversion ?? 100) < 15,
      'Conversão',
      'Finalize com mais calma: a conversão de chutes em gols está baixa nesta janela.',
    );
    add(
      playerRole !== 'forward' &&
        values.passesAttempted >= 10 &&
        (values.passAccuracy ?? 100) < 75,
      'Precisão de passe',
      'Reduza passes forçados e priorize opções seguras para melhorar a precisão.',
    );
    add(
      (playerRole === 'defender' || playerRole === 'midfielder') &&
        values.tacklesAttempted >= 5 &&
        (values.tackleAccuracy ?? 100) < 50,
      'Precisão de desarme',
      'Escolha melhor o momento do bote para converter mais desarmes.',
    );
    add(
      playerRole === 'forward' && values.shots === 0,
      'Volume de finalização',
      'Procure atacar mais a área e concluir as jogadas quando estiver em posição ofensiva.',
    );
  }
  return result;
}
