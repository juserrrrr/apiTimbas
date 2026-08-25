import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { EaFcClubsProvider } from './ea-fc-clubs.provider';
import { EaFcClubNotFoundError } from './ea-fc-clubs.types';
import { EA_MATCH_FIXTURE } from './fixtures/ea-match.fixture';

describe('EaFcClubsProvider', () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'EA_FC_MAX_RETRIES') return 0;
      if (key === 'EA_FC_REQUESTS_PER_SECOND') return 10000;
      return undefined;
    }),
  } as unknown as ConfigService;

  it('calls the EA matches endpoint and validates its payload', async () => {
    const get = jest.fn().mockReturnValue(of({ data: [EA_MATCH_FIXTURE] }));
    const provider = new EaFcClubsProvider(
      { get } as unknown as HttpService,
      config,
    );

    const matches = await provider.getClubMatches('123456', 'common-gen5');

    expect(matches).toHaveLength(1);
    expect(get).toHaveBeenCalledWith(
      'clubs/matches',
      expect.objectContaining({
        params: expect.objectContaining({
          platform: 'common-gen5',
          clubIds: '123456',
          matchType: 'friendlyMatch',
          maxResultCount: 100,
        }),
      }),
    );
  });

  it('skips an incomplete live match and keeps completed matches', async () => {
    const incomplete = {
      ...EA_MATCH_FIXTURE,
      matchId: 'still-live',
      clubs: {},
    };
    const get = jest.fn().mockReturnValue(of({ data: [incomplete, EA_MATCH_FIXTURE] }));
    const provider = new EaFcClubsProvider(
      { get } as unknown as HttpService,
      config,
    );

    const matches = await provider.getClubMatches('123456', 'common-gen5');

    expect(matches).toHaveLength(1);
    expect(matches[0].externalMatchId).toBe(String(EA_MATCH_FIXTURE.matchId));
  });

  it('returns every club found by name', async () => {
    const get = jest.fn().mockReturnValue(
      of({
        data: [
          { clubInfo: { clubId: 1, name: 'Timbas FC' } },
          { clubInfo: { clubId: 2, name: 'Timbas United' } },
        ],
      }),
    );
    const provider = new EaFcClubsProvider(
      { get } as unknown as HttpService,
      config,
    );

    const clubs = await provider.searchClubs('Timbas', 'common-gen5');

    expect(clubs).toHaveLength(2);
    expect(get).toHaveBeenCalledWith(
      'allTimeLeaderboard/search',
      expect.objectContaining({
        params: { platform: 'common-gen5', clubName: 'Timbas' },
      }),
    );
  });

  it('exposes an upstream 404 as club not found', async () => {
    const error = new AxiosError('not found');
    error.response = { status: 404 } as never;
    const provider = new EaFcClubsProvider(
      {
        get: jest.fn().mockReturnValue(throwError(() => error)),
      } as unknown as HttpService,
      config,
    );

    await expect(
      provider.getClub('missing', 'common-gen5'),
    ).rejects.toBeInstanceOf(EaFcClubNotFoundError);
  });
});
