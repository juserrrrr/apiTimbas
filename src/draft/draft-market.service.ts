import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DraftLeagueStatus,
  Prisma,
  TransferOfferKind,
  TransferOfferStatus,
  WalletTxType,
} from '@prisma/client';
import { Actor } from '../common/actor.service';
import { WalletService } from '../economy/wallet.service';
import { PrismaService } from '../prisma/prisma.service';
import { DraftAccessService } from './draft-access.service';
import { CreateOfferDto } from './dto/draft.dto';

@Injectable()
export class DraftMarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DraftAccessService,
    private readonly wallet: WalletService,
  ) {}

  async createOffer(leagueId: string, dto: CreateOfferDto, actor: Actor) {
    const league = await this.requireOpenMarket(leagueId);
    const roster = await this.access.requireRoster(leagueId, actor);
    const player = await this.requirePlayer(leagueId, dto.playerId);

    if (player.rosterId === roster.id) {
      throw new BadRequestException('Esse jogador já é seu.');
    }

    if (dto.kind === TransferOfferKind.BUY_FREE_AGENT) {
      if (player.rosterId) throw new BadRequestException('Esse jogador não está livre no mercado.');
      return this.buyFreeAgent(league.id, league.name, roster.id, actor, player);
    }

    if (!player.rosterId) throw new BadRequestException('Esse jogador está livre. Use a compra direta.');

    const squadSize = await this.prisma.draftPlayer.count({ where: { rosterId: roster.id } });
    if (dto.kind === TransferOfferKind.BUY_FROM_ROSTER && squadSize >= league.rosterSize) {
      throw new BadRequestException('Seu elenco está cheio. Venda ou troque alguém antes de comprar.');
    }

    if (dto.kind === TransferOfferKind.SWAP) {
      if (!dto.offeredPlayerId) throw new BadRequestException('Informe qual jogador você oferece na troca.');
      const offered = await this.requirePlayer(leagueId, dto.offeredPlayerId);
      if (offered.rosterId !== roster.id) {
        throw new BadRequestException('Só dá para oferecer jogadores do seu elenco.');
      }
    }

    return this.prisma.transferOffer.create({
      data: {
        leagueId,
        kind: dto.kind,
        playerId: dto.playerId,
        fromRosterId: roster.id,
        toRosterId: player.rosterId,
        offeredPlayerId: dto.kind === TransferOfferKind.SWAP ? dto.offeredPlayerId : null,
        price: dto.price ?? 0,
        message: dto.message,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
      include: this.offerInclude(),
    });
  }

  async respond(leagueId: string, offerId: string, accept: boolean, actor: Actor) {
    const league = await this.requireOpenMarket(leagueId);
    const offer = await this.prisma.transferOffer.findFirst({
      where: { id: offerId, leagueId },
      include: { fromRoster: true, toRoster: true, player: true },
    });
    if (!offer) throw new NotFoundException('Proposta não encontrada.');
    if (offer.status !== TransferOfferStatus.PENDING) {
      throw new BadRequestException('Esta proposta já foi respondida.');
    }
    if (!offer.toRoster || offer.toRoster.userId !== actor.id) {
      throw new ForbiddenException('Só o dono do jogador pode responder esta proposta.');
    }

    if (!accept) {
      return this.prisma.transferOffer.update({
        where: { id: offerId },
        data: { status: TransferOfferStatus.REJECTED, respondedAt: new Date() },
        include: this.offerInclude(),
      });
    }

    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.draftPlayer.findUniqueOrThrow({ where: { id: offer.playerId } });
        if (current.rosterId !== offer.toRosterId) {
          throw new BadRequestException('O jogador mudou de elenco desde que a proposta foi feita.');
        }

        if (offer.price > 0) {
          await this.wallet.transfer(
            offer.fromRoster.userId,
            offer.toRoster!.userId,
            offer.price,
            `Transferência de ${current.name} na ${league.name}`,
            { type: 'draftTransfer', id: offer.id },
            tx,
          );
        }

        await tx.draftPlayer.update({
          where: { id: offer.playerId },
          data: { rosterId: offer.fromRosterId, starter: false, slot: null },
        });

        if (offer.kind === TransferOfferKind.SWAP && offer.offeredPlayerId) {
          const offered = await tx.draftPlayer.findUniqueOrThrow({ where: { id: offer.offeredPlayerId } });
          if (offered.rosterId !== offer.fromRosterId) {
            throw new BadRequestException('O jogador oferecido não pertence mais a quem propôs.');
          }
          await tx.draftPlayer.update({
            where: { id: offer.offeredPlayerId },
            data: { rosterId: offer.toRosterId, starter: false, slot: null },
          });
        }

        await tx.transferOffer.updateMany({
          where: { leagueId, playerId: offer.playerId, status: TransferOfferStatus.PENDING, id: { not: offerId } },
          data: { status: TransferOfferStatus.CANCELLED, respondedAt: new Date() },
        });

        return tx.transferOffer.update({
          where: { id: offerId },
          data: { status: TransferOfferStatus.ACCEPTED, respondedAt: new Date() },
          include: this.offerInclude(),
        });
      },
      { timeout: 30000 },
    );
  }

  async cancel(leagueId: string, offerId: string, actor: Actor) {
    const offer = await this.prisma.transferOffer.findFirst({
      where: { id: offerId, leagueId },
      include: { fromRoster: true },
    });
    if (!offer) throw new NotFoundException('Proposta não encontrada.');
    if (offer.fromRoster.userId !== actor.id) {
      throw new ForbiddenException('Só quem fez a proposta pode cancelá-la.');
    }
    if (offer.status !== TransferOfferStatus.PENDING) {
      throw new BadRequestException('Esta proposta já foi respondida.');
    }

    return this.prisma.transferOffer.update({
      where: { id: offerId },
      data: { status: TransferOfferStatus.CANCELLED, respondedAt: new Date() },
      include: this.offerInclude(),
    });
  }

  async release(leagueId: string, playerId: string, actor: Actor) {
    const league = await this.requireOpenMarket(leagueId);
    const roster = await this.access.requireRoster(leagueId, actor);
    const player = await this.requirePlayer(leagueId, playerId);
    if (player.rosterId !== roster.id) throw new ForbiddenException('Esse jogador não é do seu elenco.');

    const refund = Math.floor(player.price / 2);
    return this.prisma.$transaction(async (tx) => {
      await tx.draftPlayer.update({
        where: { id: playerId },
        data: { rosterId: null, starter: false, slot: null },
      });
      if (refund > 0) {
        await this.wallet.credit(
          {
            userId: actor.id,
            amount: refund,
            type: WalletTxType.DRAFT_SALE,
            description: `Venda de ${player.name} na ${league.name}`,
            referenceType: 'draftPlayer',
            referenceId: playerId,
          },
          tx,
        );
      }
      return { released: true, refund };
    });
  }

  async listOffers(leagueId: string, actor: Actor) {
    const access = await this.access.of(leagueId, actor);
    const offers = await this.prisma.transferOffer.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: this.offerInclude(),
    });

    return offers.map((offer) => ({
      ...offer,
      canRespond: offer.status === TransferOfferStatus.PENDING && offer.toRosterId === access.rosterId,
      canCancel: offer.status === TransferOfferStatus.PENDING && offer.fromRosterId === access.rosterId,
    }));
  }

  private async buyFreeAgent(
    leagueId: string,
    leagueName: string,
    rosterId: string,
    actor: Actor,
    player: { id: string; name: string; price: number },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const league = await tx.draftLeague.findUniqueOrThrow({ where: { id: leagueId } });
      const squadSize = await tx.draftPlayer.count({ where: { rosterId } });
      if (squadSize >= league.rosterSize) {
        throw new BadRequestException('Seu elenco está cheio.');
      }

      const current = await tx.draftPlayer.findUniqueOrThrow({ where: { id: player.id } });
      if (current.rosterId) throw new BadRequestException('Esse jogador acabou de ser contratado por outro elenco.');

      if (player.price > 0) {
        await this.wallet.debit(
          {
            userId: actor.id,
            amount: player.price,
            type: WalletTxType.DRAFT_PURCHASE,
            description: `Contratação de ${player.name} na ${leagueName}`,
            referenceType: 'draftPlayer',
            referenceId: player.id,
          },
          tx,
        );
      }

      const updated = await tx.draftPlayer.update({ where: { id: player.id }, data: { rosterId } });
      return { signed: true, price: player.price, player: updated };
    });
  }

  private async requireOpenMarket(leagueId: string) {
    const league = await this.access.requireLeague(leagueId);
    if (league.status !== DraftLeagueStatus.ACTIVE) {
      throw new BadRequestException('O mercado só abre depois que o draft termina.');
    }
    if (!league.transferWindowOpen) {
      throw new BadRequestException('A janela de transferências está fechada.');
    }
    return league;
  }

  private async requirePlayer(leagueId: string, playerId: string) {
    const player = await this.prisma.draftPlayer.findFirst({ where: { id: playerId, leagueId } });
    if (!player) throw new NotFoundException('Jogador não encontrado nesta liga.');
    return player;
  }

  private offerInclude(): Prisma.TransferOfferInclude {
    return {
      player: { select: { id: true, name: true, position: true, overall: true, photoUrl: true } },
      fromRoster: { select: { id: true, name: true, tag: true, logoUrl: true } },
      toRoster: { select: { id: true, name: true, tag: true, logoUrl: true } },
    };
  }
}
