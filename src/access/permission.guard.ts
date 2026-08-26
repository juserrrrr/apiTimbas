import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorService } from '../common/actor.service';
import { AccessService } from './access.service';

export const PERMISSIONS_KEY = 'permissions';

/// Exige ao menos uma das permissões da lista. ADMIN da plataforma passa sempre.
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
    private readonly actor: ActorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredSets = (this.reflector.getAll(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) as Array<string[] | undefined>).filter((required): required is string[] => Boolean(required?.length));
    if (requiredSets.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    if (request.tokenPayload?.impersonatedBy) {
      throw new ForbiddenException('Ações administrativas ficam bloqueadas durante a visualização como usuário.');
    }
    const actor = await this.actor.require(request.tokenPayload?.discordId);
    const { permissions } = await this.access.permissionsOf(actor.id);
    for (const required of requiredSets) {
      if (!required.some((key) => permissions.includes(key))) {
        throw new ForbiddenException('Você não tem permissão para isso.');
      }
    }
    return true;

  }
}
