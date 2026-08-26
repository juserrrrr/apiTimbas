import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.getTokenHeader(request);

    if (!token) {
      throw new UnauthorizedException('Token not found');
    }
    const payload = await this.authService.validateSessionToken(token);
    request.tokenPayload = payload;
    return true;
  }

  private getTokenHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    // Impersonation uses a short-lived JWT in the header while the original
    // admin stays safely stored in the httpOnly cookie. Session hints are not
    // JWTs, so regular Discord sessions still fall back to that cookie.
    if (
      type === 'Bearer' &&
      token &&
      !token.startsWith('session.') &&
      token.split('.').length === 3
    ) {
      return token;
    }
    if (request.cookies?.timbas_token) {
      return request.cookies.timbas_token;
    }
    if (type === 'Bearer' && token) return token;
    // Fallback: Tenta pegar o token do cookie (pois o oauth loga apenas salvando cookie httpOnly)
    return undefined;
  }
}
