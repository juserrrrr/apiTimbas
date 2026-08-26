import { Prisma, TournamentMatchStatus } from '@prisma/client';
import {
  clearedMatchState,
  reversedStandingsDelta,
  stripWalkoverLabel,
} from './team-replacement';

describe('stripWalkoverLabel', () => {
  it('tira o sufixo de W.O. com motivo', () => {
    expect(stripWalkoverLabel('Rodada 1 (W.O.: não compareceu)')).toBe('Rodada 1');
  });

  it('tira o sufixo de W.O. sem motivo', () => {
    expect(stripWalkoverLabel('Rodada 1 (W.O.)')).toBe('Rodada 1');
  });

  it('mantém o label de quem nunca teve W.O.', () => {
    expect(stripWalkoverLabel('Rodada 1')).toBe('Rodada 1');
    expect(stripWalkoverLabel(null)).toBeNull();
  });
});

describe('clearedMatchState', () => {
  const now = new Date('2026-08-25T12:00:00.000Z');

  it('reabre a partida que tem os dois times e reinicia o prazo de W.O.', () => {
    const state = clearedMatchState(
      { label: 'Rodada 1 (W.O.)', homeTeamId: 'a', awayTeamId: 'b' },
      'Clube substituído.',
      now,
    );

    expect(state.status).toBe(TournamentMatchStatus.READY);
    expect(state.readyAt).toBe(now);
    expect(state.label).toBe('Rodada 1');
  });

  it('deixa pendente a partida que ainda não tem os dois times', () => {
    const state = clearedMatchState({ label: 'Semifinal', homeTeamId: 'a', awayTeamId: null }, 'x', now);

    expect(state.status).toBe(TournamentMatchStatus.PENDING);
    expect(state.readyAt).toBeNull();
  });

  it('apaga placar, registro da EA, placar informado e pedido de revisão', () => {
    const state = clearedMatchState({ label: null, homeTeamId: 'a', awayTeamId: 'b' }, 'x', now);

    expect(state.homeScore).toBeNull();
    expect(state.awayScore).toBeNull();
    expect(state.winnerTeamId).toBeNull();
    expect(state.playedAt).toBeNull();
    expect(state.eaMatchId).toBeNull();
    expect(state.eaVerifiedAt).toBeNull();
    expect(state.eaRaw).toBe(Prisma.DbNull);
    expect(state.eaTags).toEqual([]);
    expect(state.claimedAt).toBeNull();
    expect(state.claimedHomeScore).toBeNull();
    expect(state.reviewRequestedAt).toBeNull();
    expect(state.homeGraceUsed).toBe(false);
    expect(state.awayGraceUsed).toBe(false);
  });
});

describe('reversedStandingsDelta', () => {
  const rules = { pointsWin: 3, pointsDraw: 1, pointsLoss: 0 };

  it('devolve a vitória do adversário', () => {
    expect(reversedStandingsDelta(rules, 2, 1)).toEqual({
      played: { decrement: 1 },
      wins: { decrement: 1 },
      draws: { decrement: 0 },
      losses: { decrement: 0 },
      scoreFor: { decrement: 2 },
      scoreAgainst: { decrement: 1 },
      points: { decrement: 3 },
    });
  });

  it('devolve o empate sem tirar vitória nem derrota', () => {
    const delta = reversedStandingsDelta(rules, 0, 0);

    expect(delta.draws).toEqual({ decrement: 1 });
    expect(delta.wins).toEqual({ decrement: 0 });
    expect(delta.losses).toEqual({ decrement: 0 });
    expect(delta.points).toEqual({ decrement: 1 });
  });

  it('devolve a derrota com os pontos da regra do campeonato', () => {
    const delta = reversedStandingsDelta({ pointsWin: 3, pointsDraw: 1, pointsLoss: -1 }, 1, 4);

    expect(delta.losses).toEqual({ decrement: 1 });
    expect(delta.points).toEqual({ decrement: -1 });
  });
});
