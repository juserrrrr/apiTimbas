import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuctionStatus, DraftBudgetTxType, DraftLeague, DraftLeagueStatus, Prisma } from '@prisma/client';
import { Actor } from '../common/actor.service';
import { PrismaService } from '../prisma/prisma.service';
import { DraftAccessService } from './draft-access.service';
import { DraftBudgetService } from './draft-budget.service';
import { extendedDeadline, minimumBid } from './auction-rules';
import { CreateAuctionDto } from './dto/draft.dto';

/// Leilão de lance aberto. Três decisões que valem explicar:
/// o dinheiro do líder fica preso no lance, então ninguém ganha leilão sem caixa;
/// lance no fim empurra o prazo, para não virar disputa de último segundo; e o
/// leilão fecha no horário dele mesmo que a janela de transferências já tenha
/// fechado, porque fechar é apuração, não negociação.
@Injectable()
export class DraftAuctionService {
  private readonly logger = new Logger(DraftAuctionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DraftAccessService,
    private readonly budget: DraftBudgetService,
  ) {}

  async list(leagueId: string, actor: Actor) {
    const league = await this.access.requireLeague(leagueId);
    const access = await this.access.of(leagueId, actor);
    const auctions = await this.prisma.draftAuction.findMany({
      where: { leagueId },
      orderBy: [{ status: 'asc' }, { endsAt: 'asc' }],
      take: 80,
      include: {
        player: { select: { id: true, name: true, position: true, overall: true, price: true, salary: true, photoUrl: true, realTeam: true } },
        sellerRoster: { select: { id: true, name: true, tag: true } },
        leaderRoster: { select: { id: true, name: true, tag: true } },
        bids: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { roster: { select: { id: true, name: true, tag: true } } },
        },
      },
    });

    return auctions.map((auction) => ({
      ...auction,
      minimumBid: minimumBid(
        auction.currentBid,
        auction.startingBid,
        auction.bidCount,
        league.auctionMinIncrementPercent,
      ),
      isMine: auction.sellerRosterId === access.rosterId,
      isLeading: auction.leaderRosterId === access.rosterId,
      canManage: access.canModerate || auction.sellerRosterId === access.rosterId,
    }));
  }

  async create(leagueId: string, dto: CreateAuctionDto, actor: Actor) {
    const league = await this.requireAuctionsOpen(leagueId);
    const access = await this.access.of(leagueId, actor);

    const player = await this.prisma.draftPlayer.findFirst({ where: { id: dto.playerId, leagueId } });
    if (!player) throw new NotFoundException('Jogador não encontrado nesta liga.');

    const running = await this.prisma.draftAuction.findFirst({
      where: { playerId: player.id, status: AuctionStatus.OPEN },
    });
    if (running) throw new BadRequestException('Esse jogador já está em leilão.');

    // Elenco leiloa quem é dele; jogador livre do pool só a organização leiloa.
    if (player.rosterId) {
      if (player.rosterId !== access.rosterId && !access.canModerate) {
        throw new ForbiddenException('Só o dono do jogador pode leiloá-lo.');
      }
    } else if (!access.canModerate) {
      throw new ForbiddenException('Jogador livre é leiloado pela organização.');
    }

    const hours = dto.hours ?? league.auctionHours;
    return this.prisma.draftAuction.create({
      data: {
        leagueId,
        playerId: player.id,
        sellerRosterId: player.rosterId,
        startingBid: dto.startingBid ?? player.price,
        endsAt: new Date(Date.now() + hours * 60 * 60 * 1000),
      },
      include: { player: { select: { name: true } } },
    });
  }

  async bid(leagueId: string, auctionId: string, amount: number, actor: Actor) {
    const league = await this.requireAuctionsOpen(leagueId);
    const roster = await this.access.requireRoster(leagueId, actor);

    return this.prisma.$transaction(
      async (tx) => {
        const auction = await tx.draftAuction.findFirst({
          where: { id: auctionId, leagueId },
          include: { player: { select: { name: true } } },
        });
        if (!auction) throw new NotFoundException('Leilão não encontrado.');
        if (auction.status !== AuctionStatus.OPEN) throw new BadRequestException('Este leilão já foi encerrado.');
        if (auction.endsAt.getTime() <= Date.now()) throw new BadRequestException('Este leilão acabou de fechar.');
        if (auction.sellerRosterId === roster.id) {
          throw new BadRequestException('Você não pode dar lance no seu próprio jogador.');
        }
        if (auction.leaderRosterId === roster.id) {
          throw new BadRequestException('Você já está na frente neste leilão.');
        }

        const squadSize = await tx.draftPlayer.count({ where: { rosterId: roster.id } });
        if (squadSize >= league.rosterSize) {
          throw new BadRequestException('Seu elenco está cheio. Libere alguém antes de dar lance.');
        }

        const minimum = minimumBid(
          auction.currentBid,
          auction.startingBid,
          auction.bidCount,
          league.auctionMinIncrementPercent,
        );
        if (amount < minimum) {
          throw new BadRequestException(`O lance mínimo agora é ${minimum}.`);
        }

        // O dinheiro sai na hora e volta para quem for coberto depois.
        await this.budget.debit(
          {
            leagueId,
            rosterId: roster.id,
            amount,
            type: DraftBudgetTxType.AUCTION_BID,
            description: `Lance em ${auction.player.name}`,
          },
          tx,
        );

        if (auction.leaderRosterId) {
          await this.budget.credit(
            {
              leagueId,
              rosterId: auction.leaderRosterId,
              amount: auction.currentBid,
              type: DraftBudgetTxType.AUCTION_REFUND,
              description: `Lance coberto em ${auction.player.name}`,
            },
            tx,
          );
        }

        await tx.draftAuctionBid.create({ data: { auctionId, rosterId: roster.id, amount } });

        const endsAt = extendedDeadline(auction.endsAt, new Date(), league.auctionAntiSnipeMinutes);

        return tx.draftAuction.update({
          where: { id: auctionId },
          data: { currentBid: amount, leaderRosterId: roster.id, bidCount: { increment: 1 }, endsAt },
        });
      },
      { timeout: 30000 },
    );
  }

  async cancel(leagueId: string, auctionId: string, actor: Actor) {
    const access = await this.access.of(leagueId, actor);
    const auction = await this.prisma.draftAuction.findFirst({
      where: { id: auctionId, leagueId },
      include: { player: { select: { name: true } } },
    });
    if (!auction) throw new NotFoundException('Leilão não encontrado.');
    if (auction.status !== AuctionStatus.OPEN) throw new BadRequestException('Este leilão já foi encerrado.');

    const isSeller = auction.sellerRosterId === access.rosterId;
    if (!isSeller && !access.canModerate) {
      throw new ForbiddenException('Só quem abriu o leilão ou a organização pode cancelar.');
    }
    if (isSeller && !access.canModerate && auction.bidCount > 0) {
      throw new BadRequestException('Já tem lance neste leilão. Só a organização pode cancelar agora.');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.refundLeader(tx, auction, 'Leilão cancelado');
      return tx.draftAuction.update({
        where: { id: auctionId },
        data: { status: AuctionStatus.CANCELLED, closedAt: new Date(), leaderRosterId: null, currentBid: 0 },
      });
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async closeExpired() {
    const due = await this.prisma.draftAuction.findMany({
      where: { status: AuctionStatus.OPEN, endsAt: { lte: new Date() } },
      include: { player: { select: { name: true, salary: true } }, league: { select: { name: true } } },
      take: 50,
    });

    for (const auction of due) {
      try {
        await this.close(auction.id);
      } catch (error) {
        this.logger.warn(`Falha ao fechar o leilão ${auction.id}: ${(error as Error).message}`);
      }
    }
  }

  private async close(auctionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const auction = await tx.draftAuction.findUniqueOrThrow({
        where: { id: auctionId },
        include: { player: { select: { name: true } } },
      });
      if (auction.status !== AuctionStatus.OPEN) return auction;

      if (!auction.leaderRosterId) {
        this.logger.log(`Leilão de ${auction.player.name} fechou sem lance.`);
        return tx.draftAuction.update({
          where: { id: auctionId },
          data: { status: AuctionStatus.EXPIRED, closedAt: new Date() },
        });
      }

      await tx.draftPlayer.update({
        where: { id: auction.playerId },
        data: { rosterId: auction.leaderRosterId, starter: false, slot: null },
      });

      // O dinheiro do líder já saiu no lance, então aqui só o vendedor recebe.
      if (auction.sellerRosterId) {
        await this.budget.credit(
          {
            leagueId: auction.leagueId,
            rosterId: auction.sellerRosterId,
            amount: auction.currentBid,
            type: DraftBudgetTxType.AUCTION_SALE,
            description: `Leilão de ${auction.player.name}`,
          },
          tx,
        );
      }

      await tx.transferOffer.updateMany({
        where: { playerId: auction.playerId, status: 'PENDING' },
        data: { status: 'CANCELLED', respondedAt: new Date() },
      });

      this.logger.log(`Leilão de ${auction.player.name} fechou em ${auction.currentBid}.`);
      return tx.draftAuction.update({
        where: { id: auctionId },
        data: { status: AuctionStatus.SOLD, closedAt: new Date() },
      });
    });
  }

  private async refundLeader(
    tx: Prisma.TransactionClient,
    auction: { leagueId: string; leaderRosterId: string | null; currentBid: number; player: { name: string } },
    reason: string,
  ) {
    if (!auction.leaderRosterId) return;
    await this.budget.credit(
      {
        leagueId: auction.leagueId,
        rosterId: auction.leaderRosterId,
        amount: auction.currentBid,
        type: DraftBudgetTxType.AUCTION_REFUND,
        description: `${reason}: ${auction.player.name}`,
      },
      tx,
    );
  }

  private async requireAuctionsOpen(leagueId: string): Promise<DraftLeague> {
    const league = await this.access.requireLeague(leagueId);
    if (!league.auctionsEnabled) throw new BadRequestException('Esta liga não usa leilão.');
    if (league.status !== DraftLeagueStatus.ACTIVE) {
      throw new BadRequestException('O leilão abre depois que o draft termina.');
    }
    if (!league.transferWindowOpen) {
      throw new BadRequestException('A janela de transferências está fechada, ninguém dá lance agora.');
    }
    return league;
  }
}
