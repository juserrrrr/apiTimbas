import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CompetitionRole } from '@prisma/client';
import { Actor } from '../common/actor.service';
import { Role } from '../enums/role.enum';
import { PrismaService } from '../prisma/prisma.service';

export interface TournamentAccess {
  isPlatformAdmin: boolean;
  isOwner: boolean;
  isModerator: boolean;
  canManage: boolean;
  canModerate: boolean;
  canView: boolean;
  isInvited: boolean;
  teamIds: string[];
}

@Injectable()
export class TournamentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async of(tournamentId: string, actor: Actor): Promise<TournamentAccess> {
    const [tournament, staff, memberships, ownedTeams, invite] = await Promise.all([
      this.prisma.tournament.findUnique({ where: { id: tournamentId }, select: { accessMode: true } }),
      this.prisma.tournamentStaff.findUnique({
        where: { tournamentId_userId: { tournamentId, userId: actor.id } },
      }),
      this.prisma.tournamentTeamMember.findMany({
        where: { userId: actor.id, team: { tournamentId } },
        select: { teamId: true },
      }),
      this.prisma.tournamentTeam.findMany({
        where: { tournamentId, ownerDiscordId: actor.discordId },
        select: { id: true },
      }),
      this.prisma.tournamentInvite.findUnique({
        where: { tournamentId_userId: { tournamentId, userId: actor.id } },
      }),
    ]);
    if (!tournament) throw new NotFoundException('Campeonato não encontrado.');

    const isPlatformAdmin = actor.role === Role.ADMIN;
    const isOwner = staff?.role === CompetitionRole.OWNER;
    const isModerator = staff?.role === CompetitionRole.MODERATOR;
    const isInvited = Boolean(invite);
    const canView = true;

    return {
      isPlatformAdmin,
      isOwner,
      isModerator,
      canManage: isPlatformAdmin || isOwner,
      canModerate: isPlatformAdmin || isOwner || isModerator,
      canView,
      isInvited,
      teamIds: [...new Set([...memberships.map((m) => m.teamId), ...ownedTeams.map((t) => t.id)])],
    };
  }

  async requireView(tournamentId: string, actor: Actor): Promise<TournamentAccess> {
    const access = await this.of(tournamentId, actor);
    if (!access.canView) throw new ForbiddenException('Este campeonato é fechado e exige convite.');
    return access;
  }

  async requireManage(tournamentId: string, actor: Actor): Promise<TournamentAccess> {
    const access = await this.of(tournamentId, actor);
    if (!access.canManage) {
      throw new ForbiddenException('Apenas o dono do campeonato pode fazer isso.');
    }
    return access;
  }

  async requireModerate(tournamentId: string, actor: Actor): Promise<TournamentAccess> {
    const access = await this.of(tournamentId, actor);
    if (!access.canModerate) {
      throw new ForbiddenException('Apenas dono e moderadores do campeonato podem fazer isso.');
    }
    return access;
  }

  async requireExists(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('Campeonato não encontrado.');
    return tournament;
  }
}
