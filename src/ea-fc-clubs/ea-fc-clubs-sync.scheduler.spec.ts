import { ConfigService } from '@nestjs/config';
import { EaFcClubsSyncScheduler } from './ea-fc-clubs-sync.scheduler';
import { EaFcClubsService } from './ea-fc-clubs.service';

describe('EaFcClubsSyncScheduler', () => {
  it('synchronizes all registered clubs when enabled', async () => {
    const syncAllClubs = jest
      .fn()
      .mockResolvedValue([
        { clubId: 'club-1', clubName: 'Timbas', imported: 3, failed: 0 },
      ]);
    const scheduler = new EaFcClubsSyncScheduler(
      { syncAllClubs } as unknown as EaFcClubsService,
      { get: jest.fn().mockReturnValue('true') } as unknown as ConfigService,
    );

    await scheduler.synchronizeClubs();

    expect(syncAllClubs).toHaveBeenCalledTimes(1);
  });

  it('does not contact EA when automatic sync is disabled', async () => {
    const syncAllClubs = jest.fn();
    const scheduler = new EaFcClubsSyncScheduler(
      { syncAllClubs } as unknown as EaFcClubsService,
      { get: jest.fn().mockReturnValue('false') } as unknown as ConfigService,
    );

    await scheduler.synchronizeClubs();

    expect(syncAllClubs).not.toHaveBeenCalled();
  });
});
