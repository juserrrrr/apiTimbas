import { OFFICE_MAP } from './map';
import { clampStep, hasLineOfSight, moveTowards, resolveCollisions } from './movement';

const wall = [{ minX: 10, minZ: 0, maxX: 10.4, maxZ: 20 }];

describe('clampStep', () => {
  it('corta o passo no que cabe no tempo', () => {
    const next = clampStep({ x: 0, z: 0 }, { x: 100, z: 0 }, 2);
    expect(next.x).toBeCloseTo(2);
  });

  it('passo curto passa inteiro', () => {
    const next = clampStep({ x: 0, z: 0 }, { x: 1, z: 0 }, 2);
    expect(next.x).toBeCloseTo(1);
  });
});

describe('resolveCollisions', () => {
  it('tira o jogador de dentro da parede', () => {
    const next = resolveCollisions({ x: 10.2, z: 5 }, wall);
    expect(next.x).toBeLessThan(10);
  });

  it('quem está longe da parede não é empurrado', () => {
    const next = resolveCollisions({ x: 4, z: 5 }, wall);
    expect(next).toEqual({ x: 4, z: 5 });
  });
});

describe('moveTowards', () => {
  it('não atravessa a parede nem com passo grande', () => {
    const next = moveTowards({ x: 8, z: 5 }, { x: 14, z: 5 }, 6, wall);
    expect(next.x).toBeLessThan(10);
  });

  it('desliza pela parede em vez de travar', () => {
    const next = moveTowards({ x: 9.4, z: 5 }, { x: 10.4, z: 7 }, 3, wall);
    expect(next.z).toBeGreaterThan(5);
  });
});

describe('hasLineOfSight', () => {
  it('parede no meio corta a visão', () => {
    expect(hasLineOfSight({ x: 8, z: 5 }, { x: 12, z: 5 }, wall)).toBe(false);
  });

  it('sem nada no caminho enxerga', () => {
    expect(hasLineOfSight({ x: 2, z: 5 }, { x: 8, z: 5 }, wall)).toBe(true);
  });
});

describe('o escritório', () => {
  it('nasce com todo mundo em pé fora de parede', () => {
    for (const spawn of OFFICE_MAP.spawns) {
      expect(resolveCollisions(spawn, OFFICE_MAP.walls)).toEqual(spawn);
    }
  });

  it('deixa cada ponto de tarefa alcançável de fora da parede', () => {
    for (const spot of OFFICE_MAP.taskSpots) {
      expect(resolveCollisions({ x: spot.x, z: spot.z }, OFFICE_MAP.walls)).toEqual({ x: spot.x, z: spot.z });
    }
  });

  it('liga os dutos nos dois sentidos', () => {
    for (const vent of OFFICE_MAP.vents) {
      for (const link of vent.links) {
        const other = OFFICE_MAP.vents.find((candidate) => candidate.id === link);
        expect(other?.links).toContain(vent.id);
      }
    }
  });
});
