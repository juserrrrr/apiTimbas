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
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = this.getTokenHeader(request);

    if (!token) {
      throw new UnauthorizedException('Token not found');
    }
    const payload = this.authService.validateToken(token);
    request.tokenPayload = payload;
    return true;
  }

  private getTokenHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token) {
      return token;
    }
    // Fallback: Tenta pegar o token do cookie (pois o oauth loga apenas salvando cookie httpOnly)
    if (request.cookies && request.cookies['acessToken']) {
      return request.cookies['acessToken'];
    }
    return undefined;
  }
}
