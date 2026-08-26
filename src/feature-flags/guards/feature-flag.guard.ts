import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY } from '../../decorators/feature.decorator';
import { FeatureFlagsService } from '../feature-flags.service';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredSets = (this.reflector.getAll(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) as Array<string[] | undefined>).filter((required): required is string[] => Boolean(required?.length));
    if (requiredSets.length === 0) return true;

    for (const required of requiredSets) {
      const enabled = await Promise.all(required.map((key) => this.featureFlags.isEnabled(key)));
      if (!enabled.some(Boolean)) throw new ForbiddenException('Recurso desativado pelo administrador.');
    }
    return true;
  }
}
