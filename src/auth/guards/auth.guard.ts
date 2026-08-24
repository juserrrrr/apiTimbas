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
    if (request.cookies?.timbas_token) {
      return request.cookies.timbas_token;
    }
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token) {
      return token;
    }
    // Fallback: Tenta pegar o token do cookie (pois o oauth loga apenas salvando cookie httpOnly)
    return undefined;
  }
}
