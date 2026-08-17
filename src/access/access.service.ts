import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_PERMISSIONS, PERMISSION_CATEGORIES, sanitizePermissions } from './permissions';
import { GroupDto, PlatformSettingsDto, ReviewUserDto, SetUserGroupsDto } from './dto/access.dto';

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /// ADMIN é super admin fixo: tem tudo sem depender de grupo. Todo o resto vem
  /// da união dos grupos da pessoa.
  async permissionsOf(userId: number): Promise<{ role: Role; permissions: string[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, groups: { select: { group: { select: { permissions: true } } } } },
    });
    if (!user) return { role: Role.PLAYER, permissions: [] };
    if (user.role === Role.ADMIN) return { role: user.role, permissions: [...ALL_PERMISSIONS] };

    const permissions = new Set<string>();
    for (const membership of user.groups) {
      for (const key of membership.group.permissions) permissions.add(key);
    }
    return { role: user.role, permissions: [...permissions] };
  }

  async has(userId: number, required: string[]): Promise<boolean> {
    if (required.length === 0) return true;
    const { permissions } = await this.permissionsOf(userId);
    return required.some((key) => permissions.includes(key));
  }

  catalog() {
    return PERMISSION_CATEGORIES;
  }

  async settings() {
    const existing = await this.prisma.platformSettings.findUnique({ where: { id: 1 } });
    if (existing) return existing;
    return this.prisma.platformSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  }

  async updateSettings(dto: PlatformSettingsDto, updatedByDiscordId: string) {
    await this.settings();
    return this.prisma.platformSettings.update({
      where: { id: 1 },
      data: {
        ...(dto.requireApproval !== undefined ? { requireApproval: dto.requireApproval } : {}),
        ...(dto.approvalMessage !== undefined ? { approvalMessage: dto.approvalMessage } : {}),
        updatedByDiscordId,
      },
    });
  }

  async listGroups() {
    return this.prisma.permissionGroup.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: true } } },
    });
  }

  async createGroup(dto: GroupDto) {
    const permissions = sanitizePermissions(dto.permissions ?? []);
    const taken = await this.prisma.permissionGroup.findUnique({ where: { name: dto.name } });
    if (taken) throw new BadRequestException('Já existe um grupo com esse nome.');

    return this.prisma.permissionGroup.create({
      data: { name: dto.name, description: dto.description, permissions },
    });
  }

  async updateGroup(id: string, dto: GroupDto) {
    await this.requireGroup(id);
    return this.prisma.permissionGroup.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.permissions ? { permissions: sanitizePermissions(dto.permissions) } : {}),
      },
    });
  }

  async removeGroup(id: string) {
    await this.requireGroup(id);
    await this.prisma.permissionGroup.delete({ where: { id } });
    return { deleted: true };
  }

  async listUsers(query: { status?: UserStatus; search?: string }) {
    return this.prisma.user.findMany({
      where: {
        role: { not: Role.BOT },
        ...(query.status ? { status: query.status } : {}),
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ status: 'asc' }, { dateCreated: 'desc' }],
      take: 200,
      select: {
        id: true,
        name: true,
        discordId: true,
        avatar: true,
        role: true,
        status: true,
        statusNote: true,
        lastLoginAt: true,
        dateCreated: true,
        groups: { select: { group: { select: { id: true, name: true } } } },
      },
    });
  }

  async reviewUser(userId: number, dto: ReviewUserDto, reviewerId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    if (user.role === Role.ADMIN && dto.status !== UserStatus.APPROVED) {
      throw new BadRequestException('Um admin da plataforma não pode ser bloqueado por aqui.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        status: dto.status,
        statusNote: dto.note ?? null,
        reviewedByUserId: reviewerId,
        reviewedAt: new Date(),
      },
      select: { id: true, name: true, status: true, statusNote: true },
    });
  }

  async setUserGroups(userId: number, dto: SetUserGroupsDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const groups = await this.prisma.permissionGroup.findMany({
      where: { id: { in: dto.groupIds } },
      select: { id: true },
    });
    if (groups.length !== dto.groupIds.length) throw new BadRequestException('Algum grupo não existe.');

    await this.prisma.$transaction([
      this.prisma.userGroupMember.deleteMany({ where: { userId, groupId: { notIn: dto.groupIds } } }),
      ...dto.groupIds.map((groupId) =>
        this.prisma.userGroupMember.upsert({
          where: { userId_groupId: { userId, groupId } },
          update: {},
          create: { userId, groupId },
        }),
      ),
    ]);

    return this.permissionsOf(userId);
  }

  private async requireGroup(id: string) {
    const group = await this.prisma.permissionGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Grupo não encontrado.');
    return group;
  }
}
