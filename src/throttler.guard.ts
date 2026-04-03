import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest();

    // Requisições autenticadas (Bearer token ou cookie) não são throttleadas —
    // os endpoints já exigem JWT válido, então o abuso é inviável sem auth.
    const authHeader: string | undefined = request.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) return true;
    if (request.cookies?.acessToken) return true;

    return false;
  }
}
