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

  it('rejects gameplay markers outside every room', () => {
    const input = structuredClone(OFFICE_MAP);
    input.spawns[0] = { x: input.bounds.x, z: input.bounds.z, level: 0 };

    expect(() => service.normalize(input)).toThrow(BadRequestException);
  });

  it('publishes only the normalized map', async () => {
    settings.set.mockResolvedValue(undefined);
    const input = structuredClone(OFFICE_MAP);
    input.walls = [];

    const published = await service.publish(input);

    expect(published.walls.length).toBeGreaterThan(0);
    expect(settings.set).toHaveBeenCalledWith('games.deducao.map.v1', JSON.stringify(published));
  });
});
