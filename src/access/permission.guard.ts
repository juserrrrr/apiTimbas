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
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    if (request.tokenPayload?.impersonatedBy) {
      throw new ForbiddenException('Ações administrativas ficam bloqueadas durante a visualização como usuário.');
    }
    const actor = await this.actor.require(request.tokenPayload?.discordId);
    if (await this.access.has(actor.id, required)) return true;

    throw new ForbiddenException('Você não tem permissão para isso.');
  }
}
