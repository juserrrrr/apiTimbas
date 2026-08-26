import { AuthGuard } from './auth.guard';

describe('AuthGuard token selection', () => {
  const contextFor = (request: Record<string, any>) => ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as any;

  it('uses the impersonation JWT header before the original admin cookie', async () => {
    const validateSessionToken = jest.fn().mockResolvedValue({ sub: '2' });
    const guard = new AuthGuard({ validateSessionToken } as any);
    const request = {
      headers: { authorization: 'Bearer header.payload.signature' },
      cookies: { timbas_token: 'original-admin-cookie' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(validateSessionToken).toHaveBeenCalledWith('header.payload.signature');
  });

  it('ignores a client session hint and keeps using the httpOnly login cookie', async () => {
    const validateSessionToken = jest.fn().mockResolvedValue({ sub: '1' });
    const guard = new AuthGuard({ validateSessionToken } as any);
    const request = {
      headers: { authorization: 'Bearer session.encoded.hint' },
      cookies: { timbas_token: 'real-session-cookie' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(validateSessionToken).toHaveBeenCalledWith('real-session-cookie');
  });
});
