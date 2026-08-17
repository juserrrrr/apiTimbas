import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CompetitionRole } from '@prisma/client';
import { Actor } from '../common/actor.service';
import { Role } from '../enums/role.enum';
import { PrismaService } from '../prisma/prisma.service';

export interface DraftAccess {
  isPlatformAdmin: boolean;
  isOwner: boolean;
  isModerator: boolean;
  canManage: boolean;
  canModerate: boolean;
  rosterId: string | null;
}

@Injectable()
export class DraftAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async of(leagueId: string, actor: Actor): Promise<DraftAccess> {
    const [staff, roster] = await Promise.all([
      this.prisma.draftStaff.findUnique({ where: { leagueId_userId: { leagueId, userId: actor.id } } }),
      this.prisma.draftRoster.findUnique({ where: { leagueId_userId: { leagueId, userId: actor.id } } }),
    ]);

    const isPlatformAdmin = actor.role === Role.ADMIN;
    const isOwner = staff?.role === CompetitionRole.OWNER;
    const isModerator = staff?.role === CompetitionRole.MODERATOR;

    return {
      isPlatformAdmin,
      isOwner,
      isModerator,
      canManage: isPlatformAdmin || isOwner,
      canModerate: isPlatformAdmin || isOwner || isModerator,
      rosterId: roster?.id ?? null,
    };
  }

  async requireManage(leagueId: string, actor: Actor): Promise<DraftAccess> {
    const access = await this.of(leagueId, actor);
    if (!access.canManage) throw new ForbiddenException('Apenas o dono da liga pode fazer isso.');
    return access;
  }

  async requireModerate(leagueId: string, actor: Actor): Promise<DraftAccess> {
    const access = await this.of(leagueId, actor);
    if (!access.canModerate) throw new ForbiddenException('Apenas dono e moderadores da liga podem fazer isso.');
    return access;
  }

  async requireRoster(leagueId: string, actor: Actor) {
    const roster = await this.prisma.draftRoster.findUnique({
      where: { leagueId_userId: { leagueId, userId: actor.id } },
    });
    if (!roster) throw new ForbiddenException('Você não tem elenco nesta liga.');
    return roster;
  }

  async requireLeague(leagueId: string) {
    const league = await this.prisma.draftLeague.findUnique({ where: { id: leagueId } });
    if (!league) throw new NotFoundException('Liga não encontrada.');
    return league;
  }
}
