import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const STARTING_BALANCE = 100;

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(serverId: string, discordId: string): Promise<number> {
    const wallet = await this.prisma.pointsWallet.upsert({
      where: { serverId_discordId: { serverId, discordId } },
      create: { serverId, discordId },
      update: {},
    });
    return wallet.balance;
  }

  async credit(serverId: string, discordId: string, amount: number): Promise<number> {
    if (amount <= 0) return this.getBalance(serverId, discordId);
    const wallet = await this.prisma.pointsWallet.upsert({
      where: { serverId_discordId: { serverId, discordId } },
      create: { serverId, discordId, balance: STARTING_BALANCE + amount },
      update: { balance: { increment: amount } },
    });
    return wallet.balance;
  }

  /** Debita de forma atômica; lança BadRequest se o saldo for insuficiente. */
  async debit(serverId: string, discordId: string, amount: number): Promise<number> {
    if (amount <= 0) throw new BadRequestException('Valor inválido.');
    // garante que a carteira existe antes do decremento condicional
    await this.prisma.pointsWallet.upsert({
      where: { serverId_discordId: { serverId, discordId } },
      create: { serverId, discordId },
      update: {},
    });
    const result = await this.prisma.pointsWallet.updateMany({
      where: { serverId, discordId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (result.count === 0) {
      throw new BadRequestException('Fichas insuficientes.');
    }
    const wallet = await this.prisma.pointsWallet.findUnique({
      where: { serverId_discordId: { serverId, discordId } },
    });
    return wallet?.balance ?? 0;
  }

  async topBalances(serverId: string, limit = 5) {
    return this.prisma.pointsWallet.findMany({
      where: { serverId },
      orderBy: { balance: 'desc' },
      take: limit,
    });
  }
}
