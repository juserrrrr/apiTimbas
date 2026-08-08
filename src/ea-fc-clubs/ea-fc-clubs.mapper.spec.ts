import { EA_MATCH_FIXTURE } from './fixtures/ea-match.fixture';
import {
  mapEaClub,
  mapEaClubSearchResult,
  mapEaMatch,
} from './ea-fc-clubs.mapper';
import { EaFcPayloadError } from './ea-fc-clubs.types';

describe('EA FC Clubs mapper', () => {
  it('normalizes a real EA match field layout', () => {
    const match = mapEaMatch(EA_MATCH_FIXTURE);

    expect(match.externalMatchId).toBe('987654321');
    expect(match.homeClubName).toBe('Timbas FC');
    expect(match.homeScore).toBe(4);
    expect(match.playersByClub['123456']).toEqual([
      expect.objectContaining({
        externalPlayerId: 'player-1',
        playerName: 'Gabriel',
        rating: 9.2,
        passesAttempted: 25,
        passesCompleted: 21,
        tacklesAttempted: 3,
        tacklesCompleted: 2,
        manOfTheMatch: true,
      }),
    ]);
  });

  it('maps club info keyed by club id', () => {
    expect(
      mapEaClub(
        { '123456': { clubId: 123456, name: 'Timbas FC' } },
        '123456',
        'common-gen5',
      ),
    ).toEqual({
      externalId: '123456',
      name: 'Timbas FC',
      platform: 'common-gen5',
    });
  });

  it('uses EA team side instead of object key order', () => {
    const reversed = {
      ...EA_MATCH_FIXTURE,
      clubs: {
        '654321': EA_MATCH_FIXTURE.clubs['654321'],
        '123456': EA_MATCH_FIXTURE.clubs['123456'],
      },
    };
    expect(mapEaMatch(reversed).homeClubId).toBe('123456');
  });

  it('maps every nested leaderboard search result', () => {
    expect(
      mapEaClubSearchResult(
        { clubInfo: { clubId: 123456, name: 'Timbas FC' } },
        'common-gen5',
      ),
    ).toEqual({
      externalId: '123456',
      name: 'Timbas FC',
      platform: 'common-gen5',
    });
  });

  it('rejects a match missing its two club records', () => {
    expect(() => mapEaMatch({ ...EA_MATCH_FIXTURE, clubs: {} })).toThrow(
      EaFcPayloadError,
    );
  });
});
