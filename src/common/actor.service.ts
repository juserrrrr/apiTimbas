import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheBusService } from './cache-bus.service';
import { TtlCache } from './ttl-cache';

export interface Actor {
  id: number;
  discordId: string;
  name: string;
  role: string;
  avatar: string | null;
}

interface CachedUser {
  id: number;
  discordId: string;
  name: string;
  role: string;
  avatar: string | null;
  status: UserStatus;
  statusNote: string | null;
}

/// Segundos, não minutos: um bloqueio ou uma troca de grupo precisa valer
/// rápido. Os pontos que mexem no acesso avisam o CacheBusService e nem esperam
/// esse prazo.
const ACTOR_CACHE_MS = 15_000;

@Injectable()
export class ActorService {
  private readonly cache = new TtlCache<string, CachedUser | null>(ACTOR_CACHE_MS);

  constructor(
    private readonly prisma: PrismaService,
    cacheBus: CacheBusService,
  ) {
    cacheBus.register(
      (identity) => {
        if (identity.discordId) this.cache.delete(identity.discordId);
      },
      () => this.cache.clear(),
    );
  }

  async require(discordId?: string): Promise<Actor> {
    if (!discordId)
      throw new UnauthorizedException('Usuário não identificado no token.');

    const user = await this.cache.wrap(discordId, () =>
      this.prisma.user.findUnique({
        where: { discordId },
        select: {
          id: true,
          discordId: true,
          name: true,
          role: true,
          avatar: true,
          status: true,
          statusNote: true,
        },
      }),
    );
    if (!user)
      throw new UnauthorizedException('Usuário do token não existe mais.');
    if (user.status !== UserStatus.APPROVED) {
      throw new ForbiddenException(
        user.statusNote ?? 'Seu acesso não está ativo.',
      );
    }
    const { status, statusNote, ...actor } = user;
    return actor;
  }
}
