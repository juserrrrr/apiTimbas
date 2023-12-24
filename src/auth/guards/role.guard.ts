import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/role.enum';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]); // get roles from decorator with reflector

    if (!requiredRoles) {
      return true;
    }
    const { tokenPayload } = context.switchToHttp().getRequest(); // get tokenPayload from request
    console.log(tokenPayload);
    return requiredRoles.some((role) => tokenPayload.role?.includes(role)); // validate if user has role
  }
}
