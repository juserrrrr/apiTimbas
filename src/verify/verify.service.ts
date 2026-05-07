import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RiotService } from '../riot/riot.service';
import { StartVerifyDto } from './dto/start-verify.dto';

const DEFAULT_ICON_IDS = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29];
const VERIFY_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 3;

@Injectable()
export class VerifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly riotService: RiotService,
  ) {}

  async startVerification(discordId: string, dto: StartVerifyDto) {
    const existing = await this.prisma.verifiedAccount.findUnique({ where: { discordId } });
    if (existing) {
      throw new ConflictException(
        `Discord ID já possui uma conta verificada: ${existing.riotId}. Use /verify/unlink para desvincular.`,
      );
    }

    const [gameName, tagLine] = dto.riotId.split('#');
    const account = await this.riotService.getAccount(gameName.trim(), tagLine.trim());
    const summoner = await this.riotService.getSummonerByPuuid(account.puuid);
    const summonerId = summoner.id;
    if (!summonerId) {
      throw new BadRequestException('Não foi possível obter o ID da conta no LoL. Tente novamente em instantes.');
    }

    const currentIcon: number = summoner.profileIconId;
    const availableIcons = DEFAULT_ICON_IDS.filter((id) => id !== currentIcon);
    const targetIconId = availableIcons[Math.floor(Math.random() * availableIcons.length)];

    // Remove qualquer pending anterior para este discordId
    await this.prisma.pendingVerification.deleteMany({ where: { discordId } });

    const expiresAt = new Date(Date.now() + VERIFY_TTL_MINUTES * 60 * 1000);
    const pending = await this.prisma.pendingVerification.create({
      data: {
        discordId,
        puuid: account.puuid,
        summonerId,
        riotId: dto.riotId,
        targetIconId,
        expiresAt,
      },
    });

    return {
      pendingId: pending.id,
      targetIconId,
      iconUrl: this.riotService.buildProfileIconUrl(targetIconId),
      expiresAt: pending.expiresAt.toISOString(),
      message: 'Equipe o ícone indicado no cliente do LoL e clique em Confirmar',
    };
  }

  async confirmVerification(discordId: string, pendingId: string) {
    const pending = await this.prisma.pendingVerification.findUnique({ where: { id: pendingId } });
    if (!pending) throw new NotFoundException('Verificação pendente não encontrada');

    if (pending.discordId !== discordId) throw new ForbiddenException('Discord ID não corresponde');

    if (new Date() > pending.expiresAt) {
      await this.prisma.pendingVerification.delete({ where: { id: pendingId } });
      throw new GoneException('Verificação expirada. Inicie novamente.');
    }

    // Incrementa tentativas ANTES de checar o ícone
    const updated = await this.prisma.pendingVerification.update({
      where: { id: pendingId },
      data: { attempts: { increment: 1 } },
    });

    if (updated.attempts >= MAX_ATTEMPTS) {
      await this.prisma.pendingVerification.delete({ where: { id: pendingId } });
      throw new BadRequestException(
        'Número máximo de tentativas atingido. Por favor, inicie uma nova verificação.',
      );
    }

    let currentIcon: number;
    try {
      currentIcon = await this.riotService.getSummonerCurrentIcon(pending.puuid);
    } catch {
      throw new BadRequestException('Não foi possível verificar o ícone. Tente novamente em instantes.');
    }

    if (currentIcon !== pending.targetIconId) {
      const remaining = MAX_ATTEMPTS - updated.attempts;
      throw new BadRequestException(
        `Ícone incorreto. Você tem ${remaining} tentativa${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Remove verificação anterior do mesmo PUUID se existir em outro Discord
      await tx.verifiedAccount.deleteMany({ where: { puuid: pending.puuid } });

      await tx.verifiedAccount.create({
        data: {
          discordId,
          puuid: pending.puuid,
          riotId: pending.riotId,
          summonerId: pending.summonerId,
          iconId: pending.targetIconId,
        },
      });

      // Vincula também ao User via LeagueAccount (para integração com o resto do sistema)
      const user = await tx.user.findUnique({ where: { discordId } });
      if (user) {
        await tx.leagueAccount.upsert({
          where: { puuid: pending.puuid },
          update: { userId: user.id },
          create: { puuid: pending.puuid, userId: user.id },
        });
      }

      await tx.pendingVerification.delete({ where: { id: pendingId } });
    });

    return { message: `Conta ${pending.riotId} verificada com sucesso!`, riotId: pending.riotId };
  }

  async getStatus(discordId: string) {
    const verified = await this.prisma.verifiedAccount.findUnique({ where: { discordId } });
    if (!verified) return { verified: false };

    return {
      verified: true,
      riotId: verified.riotId,
      verifiedAt: verified.verifiedAt.toISOString(),
    };
  }

  async unlinkAccount(discordId: string) {
    const existing = await this.prisma.verifiedAccount.findUnique({ where: { discordId } });
    if (!existing) throw new NotFoundException('Nenhuma conta vinculada a este Discord ID');

    await this.prisma.verifiedAccount.delete({ where: { discordId } });
    return { message: 'Conta desvinculada com sucesso' };
  }
}
