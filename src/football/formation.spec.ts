import { isValidFormation, startersFor } from './formation';

describe('isValidFormation', () => {
  it('aceita as formações de verdade', () => {
    for (const formation of ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '5-3-2', '4-1-4-1']) {
      expect(isValidFormation(formation)).toBe(true);
    }
  });

  it('aceita duas linhas, que é o que cabe em liga de elenco curto', () => {
    expect(isValidFormation('2-2')).toBe(true);
    expect(isValidFormation('4-3')).toBe(true);
  });

  it('recusa o que não é formação', () => {
    for (const formation of ['4', '', '433', '4x3x3', '4-3-3-', '-4-3-3', '4-3-3-2-1-1']) {
      expect(isValidFormation(formation)).toBe(false);
    }
  });

  it('recusa formação que passa de onze em campo', () => {
    expect(isValidFormation('5-5-5')).toBe(false);
    expect(isValidFormation('9-9')).toBe(false);
  });
});

describe('startersFor', () => {
  it('soma as linhas e o goleiro', () => {
    expect(startersFor('4-3-3')).toBe(11);
    expect(startersFor('4-2-3-1')).toBe(11);
    expect(startersFor('3-2-1')).toBe(7);
  });
});
