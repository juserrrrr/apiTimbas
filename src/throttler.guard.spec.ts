import { ExecutionContext } from '@nestjs/common';
import { AppThrottlerGuard } from './throttler.guard';

describe('AppThrottlerGuard', () => {
  const guard = Object.create(AppThrottlerGuard.prototype) as AppThrottlerGuard;
  const shouldSkip = (type: string) =>
    (guard as any).shouldSkip({ getType: () => type } as ExecutionContext);

  it('skips non-HTTP event contexts', async () => {
    await expect(shouldSkip('rpc')).resolves.toBe(true);
    await expect(shouldSkip('ws')).resolves.toBe(true);
  });

  it('keeps HTTP requests subject to throttling', async () => {
    await expect(shouldSkip('http')).resolves.toBe(false);
  });
});
