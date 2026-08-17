/// Regras puras do leilão, para o lance mínimo e a prorrogação serem testáveis
/// sem banco.

/// Primeiro lance é o valor inicial. Depois disso o próximo lance sobe pela
/// porcentagem do lance atual, sempre pelo menos uma moeda acima.
export function minimumBid(
  currentBid: number,
  startingBid: number,
  bidCount: number,
  incrementPercent: number,
): number {
  if (bidCount === 0) return startingBid;
  const step = Math.max(1, Math.ceil((currentBid * incrementPercent) / 100));
  return currentBid + step;
}

/// Lance no fim empurra o prazo, então quem chegou no último segundo não leva de
/// graça: o outro ainda tem tempo de cobrir.
export function extendedDeadline(endsAt: Date, now: Date, antiSnipeMinutes: number): Date {
  const window = antiSnipeMinutes * 60 * 1000;
  if (window <= 0) return endsAt;
  return endsAt.getTime() - now.getTime() < window ? new Date(now.getTime() + window) : endsAt;
}
