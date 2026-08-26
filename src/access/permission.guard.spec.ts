import { PermissionGuard } from './permission.guard';

describe('PermissionGuard impersonation', () => {
  const build = (method: string) => {
    const request = { method, tokenPayload: { discordId: 'target', impersonatedBy: 1 } };
    const reflector = { getAll: jest.fn().mockReturnValue([['dashboard.tournaments']]) };
    const access = { permissionsOf: jest.fn().mockResolvedValue({ permissions: ['dashboard.tournaments'] }) };
    const actor = { require: jest.fn().mockResolvedValue({ id: 2 }) };
    const guard = new PermissionGuard(reflector as any, access as any, actor as any);
    const context = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
    return { guard, context, actor };
  };

  it('allows safe reads with the target user permissions', async () => {
    const { guard, context, actor } = build('GET');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(actor.require).toHaveBeenCalledWith('target');
  });

  it('allows mutations using the target user permissions', async () => {
    const { guard, context, actor } = build('POST');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(actor.require).toHaveBeenCalledWith('target');
  });
});
