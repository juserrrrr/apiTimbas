import { BadRequestException } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { OFFICE_MAP } from './deducao/map';
import { GameMapService } from './game-map.service';

describe('GameMapService', () => {
  const settings = {
    getMany: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  };
  const service = new GameMapService(settings as unknown as SettingsService);

  beforeEach(() => jest.clearAllMocks());

  it('normalizes the production map and rebuilds authoritative collision boxes', () => {
    const input = structuredClone(OFFICE_MAP);
    input.walls = [];
    input.obstacles = [];

    const normalized = service.normalize(input);

    expect(normalized.rooms).toHaveLength(OFFICE_MAP.rooms.length);
    expect(normalized.walls.length).toBeGreaterThan(0);
    expect(normalized.obstacles.length).toBeGreaterThan(0);
    expect(normalized.meetingSeats).toHaveLength(12);
  });

  it('keeps outdoor areas open and makes imported water impassable', () => {
    const input = structuredClone(OFFICE_MAP);
    input.rooms.push(
      {
        id: 'jardim-teste',
        name: 'Jardim',
        rect: { x: 68, z: 50, w: 4, d: 4 },
        kind: 'externa',
        level: 0,
        floor: '#528d4c',
        finish: 'grass',
        light: '#abcdef',
        doors: [],
      },
      {
        id: 'piscina-teste',
        name: 'Piscina',
        rect: { x: 69, z: 51, w: 2, d: 2 },
        kind: 'agua',
        level: 0,
        floor: '#38bdf8',
        finish: 'water',
        light: '#fedcba',
        doors: [],
      },
    );

    const normalized = service.normalize(input);

    expect(normalized.walls).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accent: '#abcdef' }),
        expect.objectContaining({ accent: '#fedcba' }),
      ]),
    );
    expect(normalized.obstacles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          minX: 69.15,
          minZ: 51.15,
          maxX: 70.85,
          maxZ: 52.85,
          level: 0,
        }),
      ]),
    );
  });

  it('rejects gameplay markers outside every room', () => {
    const input = structuredClone(OFFICE_MAP);
    input.spawns[0] = { x: input.bounds.x, z: input.bounds.z, level: 0 };

    expect(() => service.normalize(input)).toThrow(BadRequestException);
  });

  it('wraps generated seat directions instead of rejecting a full turn', () => {
    const input = structuredClone(OFFICE_MAP);
    input.meetingSeats[10].dir = Math.PI * 2 + 1.05;

    const normalized = service.normalize(input);

    expect(normalized.meetingSeats[10].dir).toBeCloseTo(1.05, 2);
  });

  it('publishes only the normalized map', async () => {
    settings.set.mockResolvedValue(undefined);
    const input = structuredClone(OFFICE_MAP);
    input.walls = [];

    const published = await service.publish(input);

    expect(published.walls.length).toBeGreaterThan(0);
    expect(settings.set).toHaveBeenCalledWith(
      'games.deducao.map.v1',
      JSON.stringify(published),
    );
  });
});
