import { applyChange, attributeChange, ageAt, nextForm, nextRatingAvg } from './development';

const NOW = new Date('2026-08-17T12:00:00Z');

const base = {
  position: 'ATA',
  birthDate: new Date('2006-01-01T00:00:00Z'),
  form: 4,
  ratingAvg: 7.6,
  matchesPlayed: 10,
  attributes: { pace: 80, shooting: 78, passing: 70, dribbling: 82, defending: 40, physical: 68 },
};

describe('nextForm', () => {
  it('sobe com nota alta e desce com nota baixa', () => {
    expect(nextForm(0, 8.2)).toBe(2);
    expect(nextForm(0, 7)).toBe(1);
    expect(nextForm(0, 4.5)).toBe(-2);
    expect(nextForm(0, 5.8)).toBe(-1);
  });

  it('puxa a forma para zero quando a nota é morna', () => {
    expect(nextForm(3, 6.4)).toBe(2);
    expect(nextForm(-3, 6.4)).toBe(-2);
    expect(nextForm(0, 6.4)).toBe(0);
  });

  it('respeita o teto e o piso', () => {
    expect(nextForm(5, 9)).toBe(5);
    expect(nextForm(-5, 3)).toBe(-5);
  });
});

describe('nextRatingAvg', () => {
  it('começa na própria nota', () => {
    expect(nextRatingAvg(null, 0, 7.3)).toBe(7.3);
  });

  it('faz média com o que já existia', () => {
    expect(nextRatingAvg(7, 1, 8)).toBe(7.5);
    expect(nextRatingAvg(6, 3, 7)).toBe(6.3);
  });
});

describe('ageAt', () => {
  it('calcula a idade e ignora data impossível', () => {
    expect(ageAt(new Date('2000-08-17T00:00:00Z'), NOW)).toBe(26);
    expect(ageAt(null, NOW)).toBeNull();
    expect(ageAt(new Date('1900-01-01T00:00:00Z'), NOW)).toBeNull();
  });
});

describe('attributeChange', () => {
  it('não mexe em quem jogou pouco', () => {
    expect(attributeChange({ ...base, matchesPlayed: 2 }, 0.01, NOW)).toBeNull();
    expect(attributeChange({ ...base, ratingAvg: null }, 0.01, NOW)).toBeNull();
  });

  it('faz o jovem em alta evoluir num atributo da posição', () => {
    const change = attributeChange(base, 0.05, NOW);
    expect(change).not.toBeNull();
    expect(change!.delta).toBe(1);
    expect(['shooting', 'dribbling', 'pace']).toContain(change!.key);
  });

  it('faz o veterano em baixa cair em ritmo ou físico', () => {
    const veteran = {
      ...base,
      birthDate: new Date('1990-01-01T00:00:00Z'),
      form: -4,
      ratingAvg: 6,
    };
    const change = attributeChange(veteran, 0.99, NOW);
    expect(change).not.toBeNull();
    expect(change!.delta).toBe(-1);
    expect(['pace', 'physical']).toContain(change!.key);
  });

  it('não deixa quem está bem cair, nem quem está mal subir', () => {
    expect(attributeChange(base, 0.99, NOW)).toBeNull();
    expect(attributeChange({ ...base, ratingAvg: 5.8, form: -4 }, 0.01, NOW)).toBeNull();
  });

  it('sem data de nascimento ninguém cai por idade', () => {
    const unknownAge = { ...base, birthDate: null, ratingAvg: 5.9, form: -4 };
    expect(attributeChange(unknownAge, 0.999, NOW)).toBeNull();
  });
});

describe('applyChange', () => {
  it('devolve os seis atributos com o ponto aplicado', () => {
    const updated = applyChange(base.attributes, { key: 'shooting', delta: 1, reason: 'evolução' });
    expect(updated).toEqual({ ...base.attributes, shooting: 79 });
  });

  it('não passa do teto da escala', () => {
    const maxed = { ...base.attributes, shooting: 99 };
    expect(applyChange(maxed, { key: 'shooting', delta: 1, reason: 'evolução' })!.shooting).toBe(99);
  });

  it('desiste quando falta algum atributo', () => {
    const incomplete = { ...base.attributes, physical: null };
    expect(applyChange(incomplete, { key: 'shooting', delta: 1, reason: 'evolução' })).toBeNull();
  });
});
