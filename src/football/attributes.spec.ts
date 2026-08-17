import { attributeLabels, clampAttribute, isGoalkeeper, overallFromAttributes } from './attributes';

describe('attributeLabels', () => {
  it('troca os rótulos para goleiro sem mudar de coluna', () => {
    expect(attributeLabels('ATA')[0]).toBe('Ritmo');
    expect(attributeLabels('GOL')[0]).toBe('Elasticidade');
    expect(attributeLabels('GOL')).toHaveLength(6);
  });

  it('reconhece o goleiro em qualquer caixa', () => {
    expect(isGoalkeeper('gol')).toBe(true);
    expect(isGoalkeeper('ZAG')).toBe(false);
  });
});

describe('clampAttribute', () => {
  it('mantém a escala de 1 a 99', () => {
    expect(clampAttribute(0)).toBe(1);
    expect(clampAttribute(140)).toBe(99);
    expect(clampAttribute('82')).toBe(82);
    expect(clampAttribute(81.6)).toBe(82);
  });

  it('devolve nulo para o que não é número', () => {
    expect(clampAttribute(undefined)).toBeNull();
    expect(clampAttribute('mais ou menos')).toBeNull();
  });
});

describe('overallFromAttributes', () => {
  const attributes = { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70 };

  it('devolve a própria média quando todos os atributos são iguais', () => {
    expect(overallFromAttributes('ATA', attributes)).toBe(70);
    expect(overallFromAttributes('GOL', attributes)).toBe(70);
  });

  it('pesa o que importa na posição', () => {
    const finisher = { ...attributes, shooting: 95 };
    expect(overallFromAttributes('ATA', finisher)).toBeGreaterThan(overallFromAttributes('ZAG', finisher));

    const marker = { ...attributes, defending: 95 };
    expect(overallFromAttributes('ZAG', marker)).toBeGreaterThan(overallFromAttributes('ATA', marker));
  });

  it('não passa de 99 nem cai abaixo de 1', () => {
    const maxed = { pace: 99, shooting: 99, passing: 99, dribbling: 99, defending: 99, physical: 99 };
    const floored = { pace: 1, shooting: 1, passing: 1, dribbling: 1, defending: 1, physical: 1 };
    expect(overallFromAttributes('MEI', maxed)).toBe(99);
    expect(overallFromAttributes('MEI', floored)).toBe(1);
  });
});
