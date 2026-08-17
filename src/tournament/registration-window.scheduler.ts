import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TournamentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentService } from './tournament.service';

@Injectable()
export class RegistrationWindowScheduler {
  private readonly logger = new Logger(RegistrationWindowScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tournaments: TournamentService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async closeExpiredRegistrations() {
    const expired = await this.prisma.tournament.findMany({
      where: {
        status: TournamentStatus.REGISTRATION,
        registrationEndsAt: { not: null, lte: new Date() },
      },
      include: { staff: { where: { role: 'OWNER' }, include: { user: true } } },
    });

    for (const tournament of expired) {
      const owner = tournament.staff[0]?.user;
      if (!tournament.autoStartOnClose || !owner) {
        await this.prisma.tournament.update({
          where: { id: tournament.id },
          data: { status: TournamentStatus.DRAFT, registrationEndsAt: null },
        });
        this.logger.log(`Inscrições encerradas em ${tournament.name}.`);
        continue;
      }

      try {
        await this.tournaments.start(tournament.id, {
          id: owner.id,
          discordId: owner.discordId,
          name: owner.name,
          role: owner.role,
          avatar: owner.avatar,
        });
        await this.prisma.tournament.update({
          where: { id: tournament.id },
          data: { registrationEndsAt: null },
        });
        this.logger.log(`${tournament.name} começou automaticamente ao fechar as inscrições.`);
      } catch (error) {
        await this.prisma.tournament.update({
          where: { id: tournament.id },
          data: { status: TournamentStatus.DRAFT, registrationEndsAt: null },
        });
        this.logger.warn(
          `Não deu para iniciar ${tournament.name} automaticamente: ${(error as Error).message}`,
        );
      }
    }
  }
}
