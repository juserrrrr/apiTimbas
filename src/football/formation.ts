const SHAPE = /^\d(?:-\d){1,4}$/;

/// Formação vale como "4-3-3": linhas de jogadores de linha, sem contar o
/// goleiro. Duas a cinco linhas, cada uma de 1 a 9.
export function isValidFormation(formation: string): boolean {
  if (!SHAPE.test(formation)) return false;
  const lines = formation.split('-').map(Number);
  return lines.every((line) => line >= 1 && line <= 9) && startersFor(formation) <= 11;
}

/// Titulares que a formação pede, contando o goleiro.
export function startersFor(formation: string): number {
  const lines = formation.split('-').map(Number);
  if (lines.some((line) => !Number.isFinite(line))) return 11;
  return lines.reduce((total, line) => total + line, 1);
}
