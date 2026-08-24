import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DraftBudgetTxType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatMoney } from '../football/market-value';

type Db = PrismaService | Prisma.TransactionClient;

interface Movement {
  leagueId: string;
  rosterId: string;
  amount: number;
  type: DraftBudgetTxType;
  description: string;
  round?: number;
}

/// Caixa do elenco dentro da liga. Não tem nada a ver com a carteira da conta: o
/// dinheiro nasce quando o draft começa, circula em salário, contratação e
/// negociação, e morre com a liga.
@Injectable()
export class DraftBudgetService {
  constructor(private readonly prisma: PrismaService) {}

  /// Recomeço do caixa: todo elenco volta para o valor inicial da liga e o
  /// extrato anterior é apagado, porque é outra temporada.
  async seed(leagueId: string, startingBudget: number, db: Db = this.prisma) {
    const rosters = await db.draftRoster.findMany({
      where: { leagueId },
      select: { id: true },
    });

    await db.draftBudgetEntry.deleteMany({ where: { leagueId } });
    for (const roster of rosters) {
      await db.draftRoster.update({
        where: { id: roster.id },
        data: { budget: startingBudget, earned: 0, spent: 0 },
      });
      await db.draftBudgetEntry.create({
        data: {
          leagueId,
          rosterId: roster.id,
          amount: startingBudget,
          balanceAfter: startingBudget,
          type: DraftBudgetTxType.SEED,
          description: 'Caixa inicial da temporada',
        },
      });
    }
    return rosters.length;
  }

  async credit(movement: Movement, db: Db = this.prisma) {
    if (movement.amount <= 0) return null;
    const roster = await db.draftRoster.update({
      where: { id: movement.rosterId },
      data: {
        budget: { increment: movement.amount },
        earned: { increment: movement.amount },
      },
    });
    return this.record(db, movement, movement.amount, roster.budget);
  }

  /// Gasto voluntário nunca fica no vermelho: sem caixa, sem contratação.
  async debit(movement: Movement, db: Db = this.prisma) {
    if (movement.amount <= 0) return null;
    const applied = await db.draftRoster.updateMany({
      where: { id: movement.rosterId, budget: { gte: movement.amount } },
      data: {
        budget: { decrement: movement.amount },
        spent: { increment: movement.amount },
      },
    });
    if (applied.count === 0) {
      const current = await db.draftRoster.findUniqueOrThrow({
        where: { id: movement.rosterId },
        select: { budget: true },
      });
      throw new BadRequestException(
        `Caixa insuficiente: você tem ${formatMoney(current.budget)} e precisa de ${formatMoney(movement.amount)}.`,
      );
    }
    const roster = await db.draftRoster.findUniqueOrThrow({
      where: { id: movement.rosterId },
    });
    return this.record(db, movement, -movement.amount, roster.budget);
  }

  /// Salário é obrigação, não escolha: ele passa mesmo sem caixa e deixa o elenco
  /// endividado, o que trava contratação até o time se recuperar.
  async charge(movement: Movement, db: Db = this.prisma) {
    if (movement.amount <= 0) return null;
    const roster = await db.draftRoster.update({
      where: { id: movement.rosterId },
      data: {
        budget: { decrement: movement.amount },
        spent: { increment: movement.amount },
      },
    });
    return this.record(db, movement, -movement.amount, roster.budget);
  }

  async transfer(
    from: { leagueId: string; rosterId: string },
    toRosterId: string,
    amount: number,
    description: string,
    db: Db = this.prisma,
  ) {
    if (amount <= 0) return;
    await this.debit(
      { ...from, amount, type: DraftBudgetTxType.TRANSFER_OUT, description },
      db,
    );
    await this.credit(
      {
        leagueId: from.leagueId,
        rosterId: toRosterId,
        amount,
        type: DraftBudgetTxType.TRANSFER_IN,
        description,
      },
      db,
    );
  }

  async statement(leagueId: string, rosterId: string) {
    const roster = await this.prisma.draftRoster.findFirst({
      where: { id: rosterId, leagueId },
      select: {
        id: true,
        name: true,
        budget: true,
        earned: true,
        spent: true,
        leagueId: true,
      },
    });
    if (!roster)
      throw new NotFoundException('Elenco nÃ£o encontrado nesta liga.');
    const [entries, wages] = await Promise.all([
      this.prisma.draftBudgetEntry.findMany({
        where: { rosterId, leagueId },
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
      this.prisma.draftPlayer.aggregate({
        where: { rosterId },
        _sum: { salary: true },
      }),
    ]);

    return { ...roster, wageBill: wages._sum.salary ?? 0, entries };
  }

  private record(
    db: Db,
    movement: Movement,
    amount: number,
    balanceAfter: number,
  ) {
    return db.draftBudgetEntry.create({
      data: {
        leagueId: movement.leagueId,
        rosterId: movement.rosterId,
        amount,
        balanceAfter,
        type: movement.type,
        description: movement.description,
        round: movement.round,
      },
    });
  }
}
