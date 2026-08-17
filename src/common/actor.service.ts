import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface Actor {
  id: number;
  discordId: string;
  name: string;
  role: string;
  avatar: string | null;
}

@Injectable()
export class ActorService {
  constructor(private readonly prisma: PrismaService) {}

  async require(discordId?: string): Promise<Actor> {
    if (!discordId) throw new UnauthorizedException('Usuário não identificado no token.');
    const user = await this.prisma.user.findUnique({
      where: { discordId },
      select: { id: true, discordId: true, name: true, role: true, avatar: true },
    });
    if (!user) throw new UnauthorizedException('Usuário do token não existe mais.');
    return user;
  }
}
