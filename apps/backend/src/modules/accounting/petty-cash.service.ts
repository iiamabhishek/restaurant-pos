import { ConflictException, Injectable } from '@nestjs/common';
import type {
  PettyCashCountDto,
  PettyCashTopupDto,
  PettyCashVoucherDto,
} from '@nodedr-restaurant/types';
import { Prisma } from '@prisma/client';
import { BranchTimeService } from '../../common/services/branch-time.service';
import { localDate } from '../../common/time';
import { PrismaService } from '../../prisma/prisma.service';

const D = (n: number | string) => new Prisma.Decimal(n);

class InsufficientFloat extends ConflictException {
  constructor(balance: Prisma.Decimal) {
    super(
      `The petty cash box only holds ${balance.toFixed(2)}. Top it up or pay a smaller amount.`,
    );
  }
}

/**
 * The petty cash box: a float that is topped up, paid out against vouchers, and counted. The balance is always the
 * sum of the ledger rows, never a stored number, and all of it is exact decimal arithmetic. Every write takes a lock on the
 * branch row so two people paying out at once cannot overdraw the box, and a repeated clientRequestId returns the
 * first result instead of posting twice.
 */
@Injectable()
export class PettyCashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: BranchTimeService,
  ) {}

  private async balanceIn(
    tx: Pick<PrismaService, 'pettyCashEntry'>,
    branchId: string,
  ): Promise<Prisma.Decimal> {
    const r = await tx.pettyCashEntry.aggregate({
      where: { branchId },
      _sum: { delta: true },
    });
    return r._sum.delta ?? D(0);
  }

  private lock(tx: Prisma.TransactionClient, branchId: string) {
    return tx.$queryRaw`SELECT id FROM branches WHERE id = ${branchId} FOR UPDATE`;
  }

  /** A retry of the same request answers with what the first one did. */
  private async replay(branchId: string, key?: string) {
    if (!key) return null;
    const prior = await this.prisma.pettyCashEntry.findUnique({
      where: { clientRequestId: key },
    });
    if (!prior) return null;
    if (prior.branchId !== branchId)
      throw new ConflictException('That request id was already used');
    return prior;
  }

  async overview(branchId: string) {
    const [balance, entries] = await Promise.all([
      this.balanceIn(this.prisma, branchId),
      this.prisma.pettyCashEntry.findMany({
        where: { branchId },
        include: {
          createdBy: { select: { id: true, name: true } },
          expense: { select: { id: true, status: true, decisionNote: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);
    return { balance: balance.toFixed(2), entries };
  }

  async topup(branchId: string, userId: string, dto: PettyCashTopupDto) {
    const prior = await this.replay(branchId, dto.clientRequestId);
    if (prior) return prior;
    return this.write(dto.clientRequestId, () =>
      this.prisma.pettyCashEntry.create({
        data: {
          branchId,
          kind: 'TOPUP',
          delta: D(dto.amount),
          note: dto.note,
          createdById: userId,
          clientRequestId: dto.clientRequestId,
        },
      }),
    );
  }

  /** Pay money out against a receipt. It also records the expense, which waits for approval unless the keeper may approve. */
  async voucher(
    branchId: string,
    userId: string,
    dto: PettyCashVoucherDto,
    canApprove: boolean,
  ) {
    const prior = await this.replay(branchId, dto.clientRequestId);
    if (prior) return prior;
    const today = localDate(new Date(), await this.time.tzForBranch(branchId));
    return this.write(dto.clientRequestId, () =>
      this.prisma.$transaction(async (tx) => {
        await this.lock(tx, branchId);
        const balance = await this.balanceIn(tx, branchId);
        const amount = D(dto.amount);
        if (amount.gt(balance)) throw new InsufficientFloat(balance);
        const expense = await tx.expense.create({
          data: {
            branchId,
            createdById: userId,
            spentOn: new Date(`${today}T00:00:00.000Z`),
            category: dto.category,
            amount,
            note: [
              dto.payee,
              dto.receiptRef && `receipt ${dto.receiptRef}`,
              dto.note,
            ]
              .filter(Boolean)
              .join(' · ')
              .slice(0, 300),
            paidFromCash: false, // from the petty cash box, not the till
            ...(canApprove
              ? {
                  status: 'APPROVED' as const,
                  decidedById: userId,
                  decidedAt: new Date(),
                }
              : { status: 'PENDING' as const }),
          },
        });
        return tx.pettyCashEntry.create({
          data: {
            branchId,
            kind: 'VOUCHER',
            delta: amount.negated(),
            category: dto.category,
            payee: dto.payee,
            receiptRef: dto.receiptRef,
            note: dto.note,
            expenseId: expense.id,
            createdById: userId,
            clientRequestId: dto.clientRequestId,
          },
        });
      }),
    );
  }

  /**
   * Count the box. The difference from the book is posted as an ADJUSTMENT so the book matches the cash again, and
   * the count itself is kept (counted, book, difference) even when it matched.
   */
  async count(branchId: string, userId: string, dto: PettyCashCountDto) {
    const prior = await this.replay(branchId, dto.clientRequestId);
    if (prior) return prior;
    return this.write(dto.clientRequestId, () =>
      this.prisma.$transaction(async (tx) => {
        await this.lock(tx, branchId);
        const book = await this.balanceIn(tx, branchId);
        const counted = D(dto.countedCash);
        return tx.pettyCashEntry.create({
          data: {
            branchId,
            kind: 'ADJUSTMENT',
            delta: counted.minus(book),
            countedCash: counted,
            bookBalance: book,
            note: dto.note ?? 'Count',
            createdById: userId,
            clientRequestId: dto.clientRequestId,
          },
        });
      }),
    );
  }

  /** Two copies of one request racing: the loser hits the unique key and gets the winner's row. */
  private async write<T extends { clientRequestId: string | null }>(
    key: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (
        key &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const winner = await this.prisma.pettyCashEntry.findUnique({
          where: { clientRequestId: key },
        });
        if (winner) return winner as unknown as T;
      }
      throw e;
    }
  }
}
