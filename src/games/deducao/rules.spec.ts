import {
  DEFAULT_CONFIG,
  assignRoles,
  canStartMatch,
  maxKillersFor,
  sanitizeConfig,
  tallyVotes,
  winnerFor,
  type PlayerSnapshot,
} from './rules';

/// Gerador previsível, para o sorteio de papéis dar sempre a mesma partida no
/// teste.
function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

const crew = (id: string, alive = true): PlayerSnapshot => ({ id, role: 'funcionario', alive });
const killer = (id: string, alive = true): PlayerSnapshot => ({ id, role: 'assassino', alive });

describe('canStartMatch', () => {
  it('permite que admin inicie sozinho para testar', () => {
    expect(canStartMatch(1, true)).toBe(true);
  });

  it('mantém o mínimo normal para os outros jogadores', () => {
    expect(canStartMatch(1, false)).toBe(false);
    expect(canStartMatch(4, false)).toBe(true);
  });
});

describe('maxKillersFor', () => {
  it('abre mais assassinos conforme a sala enche', () => {
    expect(maxKillersFor(4)).toBe(1);
    expect(maxKillersFor(8)).toBe(2);
    expect(maxKillersFor(12)).toBe(3);
  });
});

describe('sanitizeConfig', () => {
  it('não deixa a sala pequena ter mais assassino do que aguenta', () => {
    const config = sanitizeConfig({ ...DEFAULT_CONFIG, killers: 3 }, 5);
    expect(config.killers).toBe(1);
  });

  it('segura os tempos dentro do que é jogável', () => {
    const config = sanitizeConfig(
      { ...DEFAULT_CONFIG, meetingSeconds: 1, voteSeconds: 999, killCooldownMs: 1, visionRange: 99 },
      6,
    );
    expect(config.meetingSeconds).toBe(15);
    expect(config.voteSeconds).toBe(120);
    expect(config.killCooldownMs).toBe(10_000);
    expect(config.visionRange).toBe(15);
  });
});

describe('assignRoles', () => {
  it('entrega a quantidade combinada de assassinos e um detetive', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const roles = assignRoles(ids, { ...DEFAULT_CONFIG, killers: 2 }, seeded(7));
    const values = [...roles.values()];

    expect(roles.size).toBe(ids.length);
    expect(values.filter((role) => role === 'assassino')).toHaveLength(2);
    expect(values.filter((role) => role === 'detetive')).toHaveLength(1);
  });

  it('não sorteia mais assassino do que um terço da sala', () => {
    const roles = assignRoles(['a', 'b', 'c', 'd'], { ...DEFAULT_CONFIG, killers: 3 }, seeded(3));
    expect([...roles.values()].filter((role) => role === 'assassino')).toHaveLength(1);
  });

  it('dispensa o detetive quando a sala pediu para jogar sem ele', () => {
    const roles = assignRoles(['a', 'b', 'c', 'd'], { ...DEFAULT_CONFIG, withDetective: false }, seeded(9));
    expect([...roles.values()]).not.toContain('detetive');
  });
});

describe('tallyVotes', () => {
  it('ejeta quem levou mais voto', () => {
    const result = tallyVotes(new Map([['a', 'c'], ['b', 'c'], ['c', 'a']]));
    expect(result.ejected).toBe('c');
    expect(result.counts.c).toBe(2);
  });

  it('empate não ejeta ninguém', () => {
    const result = tallyVotes(new Map([['a', 'b'], ['b', 'a']]));
    expect(result.ejected).toBeNull();
    expect(result.tie).toBe(true);
  });

  it('todo mundo pulando também não ejeta', () => {
    const result = tallyVotes(new Map([['a', null], ['b', null]]));
    expect(result.ejected).toBeNull();
    expect(result.tie).toBe(false);
  });
});

describe('winnerFor', () => {
  it('sem assassino vivo o escritório ganha', () => {
    expect(winnerFor([crew('a'), killer('b', false)], 0, 10)).toBe('escritorio');
  });

  it('tarefas concluídas também ganham a partida', () => {
    expect(winnerFor([crew('a'), crew('b'), killer('c')], 10, 10)).toBe('escritorio');
  });

  it('assassino empatando em número já venceu', () => {
    expect(winnerFor([crew('a'), killer('b'), crew('c', false)], 2, 10)).toBe('assassinos');
  });

  it('partida em aberto não tem vencedor', () => {
    expect(winnerFor([crew('a'), crew('b'), crew('c'), killer('d')], 3, 10)).toBeNull();
  });
});
