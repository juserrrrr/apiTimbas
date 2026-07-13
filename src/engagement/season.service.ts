import { Injectable } from '@nestjs/common';
import { Season } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SeasonChampion {
  rank: number;
  userId: number;
  name: string;
  discordId: string;
  score: number;
  wins: number;
  losses: number;
}

@Injectable()
export class SeasonService {
  constructor(private readonly prisma: PrismaService) {}

  async getActive(serverId: string): Promise<Season | null> {
    return this.prisma.season.findFirst({
      where: { serverId, endedAt: null },
      orderBy: { number: 'desc' },
    });
  }

  /** Encerra a temporada ativa (se houver) gravando os campeões e abre a próxima. */
  async closeAndStartNext(serverId: string, champions: SeasonChampion[]): Promise<{ closed: Season | null; started: Season }> {
    const active = await this.getActive(serverId);

    let closed: Season | null = null;
    if (active) {
      closed = await this.prisma.season.update({
        where: { id: active.id },
        data: { endedAt: new Date(), champions: champions as any },
      });
    }

    const last = await this.prisma.season.findFirst({
      where: { serverId },
      orderBy: { number: 'desc' },
    });

    const started = await this.prisma.season.create({
      data: { serverId, number: (last?.number ?? 0) + 1 },
    });

    return { closed, started };
  }

  async listClosed(serverId: string, limit = 10): Promise<Season[]> {
    return this.prisma.season.findMany({
      where: { serverId, endedAt: { not: null } },
      orderBy: { number: 'desc' },
      take: limit,
    });
  }
}
