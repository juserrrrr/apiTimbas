import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WalletTxType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface CoinMovement {
  userId: number;
  amount: number;
  type: WalletTxType;
  description: string;
  referenceType?: string;
  referenceId?: string;
}

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(userId: number) {
    const wallet = await this.ensureWallet(userId);
    return {
      balance: wallet.balance,
      totalEarned: wallet.totalEarned,
      totalSpent: wallet.totalSpent,
    };
  }

  async ensureWallet(userId: number, db: Db = this.prisma) {
    const existing = await db.wallet.findUnique({ where: { userId } });
    if (existing) return existing;
    return db.wallet.upsert({ where: { userId }, update: {}, create: { userId } });
  }

  async credit(movement: CoinMovement, db: Db = this.prisma) {
    if (movement.amount <= 0) throw new BadRequestException('Valor do crédito deve ser positivo.');
    const wallet = await this.ensureWallet(movement.userId, db);
    const updated = await db.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: movement.amount },
        totalEarned: { increment: movement.amount },
      },
    });
    return this.record(db, updated.id, movement.amount, updated.balance, movement);
  }

  async debit(movement: CoinMovement, db: Db = this.prisma) {
    if (movement.amount <= 0) throw new BadRequestException('Valor do débito deve ser positivo.');
    const wallet = await this.ensureWallet(movement.userId, db);
    const applied = await db.wallet.updateMany({
      where: { id: wallet.id, balance: { gte: movement.amount } },
      data: {
        balance: { decrement: movement.amount },
        totalSpent: { increment: movement.amount },
      },
    });
    if (applied.count === 0) {
      throw new BadRequestException(
        `Saldo insuficiente: ${wallet.balance} moedas disponíveis, ${movement.amount} necessárias.`,
      );
    }
    const updated = await db.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    return this.record(db, updated.id, -movement.amount, updated.balance, movement);
  }

  async transfer(
    fromUserId: number,
    toUserId: number,
    amount: number,
    description: string,
    reference: { type: string; id: string },
    db: Db = this.prisma,
  ) {
    if (fromUserId === toUserId) throw new BadRequestException('Não é possível transferir moedas para si mesmo.');
    await this.debit(
      {
        userId: fromUserId,
        amount,
        type: WalletTxType.TRANSFER_OUT,
        description,
        referenceType: reference.type,
        referenceId: reference.id,
      },
      db,
    );
    await this.credit(
      {
        userId: toUserId,
        amount,
        type: WalletTxType.TRANSFER_IN,
        description,
        referenceType: reference.type,
        referenceId: reference.id,
      },
      db,
    );
  }

  async statement(userId: number, take: number, skip: number) {
    const wallet = await this.ensureWallet(userId);
    const [items, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);
    return {
      balance: wallet.balance,
      totalEarned: wallet.totalEarned,
      totalSpent: wallet.totalSpent,
      total,
      items,
    };
  }

  async ranking(take: number) {
    const wallets = await this.prisma.wallet.findMany({
      orderBy: [{ balance: 'desc' }, { totalEarned: 'desc' }],
      take,
      include: { user: { select: { id: true, name: true, avatar: true, discordId: true } } },
    });
    return wallets.map((wallet, index) => ({
      position: index + 1,
      userId: wallet.userId,
      name: wallet.user.name,
      avatar: wallet.user.avatar,
      balance: wallet.balance,
      totalEarned: wallet.totalEarned,
    }));
  }

  async adjust(userId: number, amount: number, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const movement: CoinMovement = {
      userId,
      amount: Math.abs(amount),
      type: WalletTxType.ADMIN_ADJUST,
      description: reason,
      referenceType: 'admin',
      referenceId: String(userId),
    };
    return amount >= 0 ? this.credit(movement) : this.debit(movement);
  }

  private record(
    db: Db,
    walletId: number,
    signedAmount: number,
    balanceAfter: number,
    movement: CoinMovement,
  ) {
    return db.walletTransaction.create({
      data: {
        walletId,
        amount: signedAmount,
        balanceAfter,
        type: movement.type,
        description: movement.description,
        referenceType: movement.referenceType,
        referenceId: movement.referenceId,
      },
    });
  }
}
