import { craqueRanker, type CraquePlayerStats } from './craque';

const base: CraquePlayerStats = {
  appearances: 5,
  ratedAppearances: 5,
  averageRating: 7,
  teamMatches: 6,
  goals: 0,
  assists: 0,
  mvps: 0,
  tacklesCompleted: 0,
  saves: 0,
  shots: 0,
  passesCompleted: 0,
  passAccuracy: null,
};

const player = (over: Partial<CraquePlayerStats>): CraquePlayerStats => ({ ...base, ...over });

describe('craqueRanker', () => {
  it('coloca quem decidiu na frente de quem só tirou nota alta', () => {
    // O caso real: zagueiro com 9,2 de média, 4 jogos e nenhuma participação em
    // gol vencia o atacante com dez participações em cinco jogos.
    const semProducao = player({
      appearances: 4,
      ratedAppearances: 4,
      averageRating: 9.2,
      teamMatches: 4,
      mvps: 2,
      tacklesCompleted: 20,
      passesCompleted: 150,
      passAccuracy: 85,
    });
    const decisivo = player({
      goals: 5,
      assists: 5,
      averageRating: 8.1,
      tacklesCompleted: 8,
      passesCompleted: 200,
      passAccuracy: 82,
    });
    const score = craqueRanker([semProducao, decisivo], 7.5);

    expect(score(decisivo).score).toBeGreaterThan(score(semProducao).score);
  });

  it('mantém o goleiro competitivo pelas defesas', () => {
    // O teto de cada parcela é o melhor do campeonato, então o time de
    // referência precisa ter um artilheiro de verdade para a conta valer.
    const artilheiro = player({ averageRating: 8.2, goals: 8, assists: 2, passesCompleted: 150, passAccuracy: 84 });
    const goleiro = player({ averageRating: 8.6, saves: 30, passesCompleted: 60, passAccuracy: 70 });
    const meia = player({ averageRating: 7.4, goals: 1, assists: 1, passesCompleted: 200, passAccuracy: 88 });
    const score = craqueRanker([artilheiro, goleiro, meia], 7.6);

    expect(score(goleiro).score).toBeGreaterThan(score(meia).score);
    expect(score(artilheiro).score).toBeGreaterThan(score(goleiro).score);
  });

  it('conta desarme de quem marca, não só quem ataca', () => {
    const volante = player({ averageRating: 7.8, tacklesCompleted: 40, passesCompleted: 180, passAccuracy: 86 });
    const reserva = player({ averageRating: 7.8, tacklesCompleted: 2, passesCompleted: 180, passAccuracy: 86 });
    const score = craqueRanker([volante, reserva], 7.5);

    expect(score(volante).score).toBeGreaterThan(score(reserva).score);
  });

  it('não deixa volume de passe errado inflar o índice', () => {
    const certeiro = player({ passesCompleted: 100, passAccuracy: 92 });
    const desperdicado = player({ passesCompleted: 100, passAccuracy: 45 });
    const score = craqueRanker([certeiro, desperdicado], 7);

    expect(score(certeiro).passing).toBeGreaterThan(score(desperdicado).passing);
  });

  it('considera finalizações sem deixá-las valer mais que produção ofensiva', () => {
    const ativo = player({ shots: 20, goals: 1, averageRating: 7.8 });
    const passivo = player({ shots: 2, goals: 1, averageRating: 7.8 });
    const decisivo = player({ shots: 8, goals: 4, averageRating: 7.8 });
    const score = craqueRanker([ativo, passivo, decisivo], 7.5);

    expect(score(ativo).shooting).toBeGreaterThan(score(passivo).shooting);
    expect(score(decisivo).score).toBeGreaterThan(score(ativo).score);
  });

  it('dá relevância ao MVP dentro do conjunto sem ignorar a produção', () => {
    const regular = player({ averageRating: 8.2, mvps: 2, goals: 1, assists: 1 });
    const produtivo = player({ averageRating: 8.2, goals: 4, assists: 2 });
    const score = craqueRanker([regular, produtivo], 7.5);

    expect(score(regular).mvp).toBeGreaterThan(score(produtivo).mvp);
    expect(score(produtivo).score).toBeGreaterThan(score(regular).score);
  });

  it('puxa para a média de quem jogou pouco', () => {
    const doisJogos = player({ appearances: 2, ratedAppearances: 2, averageRating: 9.5 });
    const campanhaInteira = player({ appearances: 6, ratedAppearances: 6, averageRating: 8.6, teamMatches: 6 });
    const score = craqueRanker([doisJogos, campanhaInteira], 7);

    // Quem tem duas partidas perde bem mais da própria nota do que quem fez a
    // campanha inteira, e ainda leva desvantagem de presença.
    expect(9.5 - score(doisJogos).adjustedRating).toBeGreaterThan(
      8.6 - score(campanhaInteira).adjustedRating,
    );
    expect(score(campanhaInteira).presence).toBeGreaterThan(score(doisJogos).presence);
  });

  it('trata campeonato sem estatística nenhuma sem quebrar', () => {
    const vazio = player({ averageRating: null, ratedAppearances: 0, appearances: 0, teamMatches: 0 });
    const score = craqueRanker([vazio], 0);

    expect(Number.isFinite(score(vazio).score)).toBe(true);
  });
});
