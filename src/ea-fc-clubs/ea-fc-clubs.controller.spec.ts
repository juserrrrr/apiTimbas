import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { EaFcClubsController } from './ea-fc-clubs.controller';

describe('EaFcClubsController authorization', () => {
  const prototype = EaFcClubsController.prototype;

  it.each(['validate', 'create', 'search', 'sync'] as const)(
    'restricts %s to administrators',
    (method) => {
      expect(Reflect.getMetadata(ROLES_KEY, prototype[method])).toEqual([
        Role.ADMIN,
      ]);
    },
  );

  it.each(['list', 'getClub', 'dashboard', 'matches', 'match', 'players', 'player', 'leaderboard'] as const)(
    'keeps %s available to authenticated users',
    (method) => {
      expect(Reflect.getMetadata(ROLES_KEY, prototype[method])).toBeUndefined();
    },
  );
});
