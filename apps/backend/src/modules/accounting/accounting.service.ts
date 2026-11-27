import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CashClosingDto, ExpenseDto } from '@nodedr-restaurant/types';
import { Prisma } from '@prisma/client';
import { localDate, zonedRange } from '../../common/time';
import { BranchTimeService } from '../../common/services/branch-time.service';
import { PrismaService } from '../../prisma/prisma.service';
import { expectedCash, gstSummary, round2 } from './accounting.calc';
import {
  imbalances,
  JOURNAL_COLUMNS,
  salesVoucher,
  toRows,
  twoLine,
  type DaySales,
  type JournalLine,
} from './journal';

const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`);
const dayAfter = (d: string) => new Date(dayStart(d).getTime() + 86_400_000);

@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: BranchTimeService,
  ) {}

  // --- Expenses ------------------------------------------------------------

  listExpenses(branchId: string, from: string, to: string) {
    return this.prisma.expense.findMany({
      where: { branchId, spentOn: { gte: dayStart(from), lte: dayStart(to) } },
      orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }

  /**
   * Someone who may approve expenses records them as approved at once (as before this existed). Everyone else
   * submits a PENDING expense that counts nowhere until an approver decides. A repeat of the same
   * clientRequestId returns the first expense, so a retry or double tap never adds a second.
   */
  async createExpense(
    branchId: string,
    userId: string,
    dto: ExpenseDto,
    canApprove = true,
  ) {
    if (dto.clientRequestId) {
      const prior = await this.prisma.expense.findUnique({
        where: { clientRequestId: dto.clientRequestId },
      });
      if (prior) return prior.branchId === branchId ? prior : this.clash();
    }
    if (dto.paidFromCash) await this.assertDayOpen(branchId, dto.spentOn);
    try {
      return await this.prisma.expense.create({
        data: {
          branchId,
          createdById: userId,
          spentOn: dayStart(dto.spentOn),
          category: dto.category,
          amount: dto.amount,
          note: dto.note,
          paidFromCash: dto.paidFromCash,
          clientRequestId: dto.clientRequestId,
          ...(canApprove
            ? {
                status: 'APPROVED' as const,
                decidedById: userId,
                decidedAt: new Date(),
              }
            : { status: 'PENDING' as const }),
        },
      });
    } catch (e) {
      if (
        dto.clientRequestId &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const prior = await this.prisma.expense.findUnique({
          where: { clientRequestId: dto.clientRequestId },
        });
        if (prior?.branchId === branchId) return prior;
      }
      throw e;
    }
  }

  private clash(): never {
    throw new ConflictException('That request id was already used');
  }

  private async assertDayOpen(branchId: string, date: string) {
    const closed = await this.prisma.cashClosing.findUnique({
      where: {
        branchId_businessDate: { branchId, businessDate: dayStart(date) },
      },
    });
    if (closed)
      throw new BadRequestException(
        'That day is already closed - the cash count includes its expenses',
      );
  }

  /** Expenses waiting for a decision, oldest first, with who submitted them. */
  pendingExpenses(branchId: string) {
    return this.prisma.expense.findMany({
      where: { branchId, status: 'PENDING' },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  /** What one person submitted, with the decision, so they can see what happened to it. */
  myExpenses(branchId: string, userId: string) {
    return this.prisma.expense.findMany({
      where: { branchId, createdById: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Approve or reject a PENDING expense, once. The conditional update means two approvers (or a double click)
   * cannot both decide it. Rejecting a petty cash voucher's expense puts its money back into the box.
   */
  async decideExpense(
    branchId: string,
    id: string,
    deciderId: string,
    approve: boolean,
    note?: string,
  ) {
    if (!approve && !note?.trim())
      throw new BadRequestException('Say why the expense is rejected');
    const expense = await this.prisma.expense.findFirst({
      where: { id, branchId },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    if (approve && expense.paidFromCash)
      await this.assertDayOpen(
        branchId,
        expense.spentOn.toISOString().slice(0, 10),
      );
    return this.prisma.$transaction(async (tx) => {
      const done = await tx.expense.updateMany({
        where: { id, branchId, status: 'PENDING' },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          decidedById: deciderId,
          decidedAt: new Date(),
          decisionNote: note?.trim() || null,
        },
      });
      if (done.count === 0)
        throw new ConflictException('That expense was already decided');
      if (!approve) {
        const voucher = await tx.pettyCashEntry.findUnique({
          where: { expenseId: id },
        });
        if (voucher) {
          await tx.pettyCashEntry.create({
            data: {
              branchId,
              kind: 'ADJUSTMENT',
              delta: voucher.delta.negated(),
              note: `Voucher rejected: ${note?.trim()}`,
              createdById: deciderId,
            },
          });
        }
      }
      return tx.expense.findUniqueOrThrow({ where: { id } });
    });
  }

  async deleteExpense(branchId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, branchId },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    const closed = await this.prisma.cashClosing.findUnique({
      where: {
        branchId_businessDate: { branchId, businessDate: expense.spentOn },
      },
    });
    if (closed && expense.paidFromCash)
      throw new BadRequestException(
        'That day is already closed — the cash count includes this expense',
      );
    await this.prisma.expense.delete({ where: { id } });
    return { ok: true };
  }

  // --- Accounting export ---------------------------------------------------

  /**
   * A balanced double-entry journal for the period, for an accountant or any accounting package's import: daily sales
   * by payment method, refunds, approved expenses, supplier invoices and payments, and purchase returns. Throws
   * rather than hand out a file that does not balance.
   */
  async journalExport(branchId: string, from: string, to: string) {
    const tz = await this.time.tzForBranch(branchId);
    const range = zonedRange(from, to, tz);
    const day = (d: Date) => localDate(d, tz);
    const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

    const [orders, refunds, expenses, invoices, payments, returns] =
      await Promise.all([
        this.prisma.order.findMany({
          where: { branchId, status: 'PAID', billedAt: range },
          select: {
            billedAt: true,
            taxAmount: true,
            tipAmount: true,
            deliveryFee: true,
            payments: { select: { method: true, amount: true } },
          },
        }),
        this.prisma.refund.findMany({
          where: { order: { branchId }, createdAt: range },
          select: { id: true, createdAt: true, amount: true, method: true },
        }),
        this.prisma.expense.findMany({
          where: {
            branchId,
            status: 'APPROVED',
            spentOn: { gte: dayStart(from), lte: dayStart(to) },
          },
          include: { pettyCashEntry: { select: { id: true } } },
        }),
        this.prisma.supplierInvoice.findMany({
          where: {
            branchId,
            status: { not: 'CANCELLED' },
            invoiceDate: range,
          },
          include: { supplier: { select: { name: true } } },
        }),
        this.prisma.supplierPayment.findMany({
          where: { branchId, paidAt: range },
          include: {
            supplierInvoice: {
              select: {
                invoiceNumber: true,
                supplier: { select: { name: true } },
              },
            },
          },
        }),
        this.prisma.purchaseReturn.findMany({
          where: { branchId, createdAt: range },
          include: { supplier: { select: { name: true } } },
        }),
      ]);

    const lines: JournalLine[] = [];
    const days = new Map<string, DaySales>();
    for (const o of orders) {
      const k = day(o.billedAt!);
      const d: DaySales = days.get(k) ?? {
        date: k,
        byMethod: new Map(),
        tax: dec(0),
        tips: dec(0),
        delivery: dec(0),
        orders: 0,
      };
      d.orders += 1;
      d.tax = d.tax.plus(o.taxAmount);
      d.tips = d.tips.plus(o.tipAmount);
      d.delivery = d.delivery.plus(o.deliveryFee);
      for (const p of o.payments)
        d.byMethod.set(
          p.method,
          (d.byMethod.get(p.method) ?? dec(0)).plus(p.amount),
        );
      days.set(k, d);
    }
    for (const d of days.values()) lines.push(...salesVoucher(d));
    const receipt = (m: string) =>
      m === 'CASH' ? 'Cash in hand' : `Receipts - ${m}`;
    for (const r of refunds)
      lines.push(
        ...twoLine(
          day(r.createdAt),
          'Refund',
          `REFUND-${r.id.slice(-8)}`,
          'Sales returns',
          receipt(r.method),
          r.amount,
          'Refund to guest',
        ),
      );
    for (const e of expenses)
      lines.push(
        ...twoLine(
          e.spentOn.toISOString().slice(0, 10),
          'Expense',
          `EXP-${e.id.slice(-8)}`,
          `Expense: ${e.category}`,
          e.paidFromCash
            ? 'Cash in hand'
            : e.pettyCashEntry
              ? 'Petty cash'
              : 'Paid from bank or other',
          e.amount,
          e.note ?? '',
        ),
      );
    for (const i of invoices)
      lines.push(
        ...twoLine(
          day(i.invoiceDate),
          'Purchase',
          i.invoiceNumber,
          'Purchases',
          `Supplier: ${i.supplier.name}`,
          i.totalAmount,
          'Supplier invoice',
        ),
      );
    for (const p of payments)
      lines.push(
        ...twoLine(
          day(p.paidAt),
          'Supplier payment',
          `PAY-${p.id.slice(-8)}`,
          `Supplier: ${p.supplierInvoice.supplier.name}`,
          receipt(p.paymentMethod),
          p.amount,
          `Invoice ${p.supplierInvoice.invoiceNumber}`,
        ),
      );
    for (const r of returns)
      lines.push(
        ...twoLine(
          day(r.createdAt),
          'Purchase return',
          r.returnNumber,
          `Supplier: ${r.supplier.name}`,
          'Purchases',
          r.totalAmount,
          r.reason,
        ),
      );

    const bad = imbalances(lines);
    if (bad.size > 0)
      throw new BadRequestException(
        `The journal does not balance for ${[...bad.keys()].slice(0, 3).join(', ')}; nothing was exported`,
      );
    return {
      key: 'journal',
      title: 'Accounting journal',
      columns: JOURNAL_COLUMNS,
      rows: toRows(lines),
    };
  }

  // --- Daily cash closing --------------------------------------------------

  /** What the till should hold for a day, before anyone counts it. */
  async closingPreview(branchId: string, date: string, openingFloat = 0) {
    const from = dayStart(date); // @db.Date column: a plain calendar date
    const range = zonedRange(date, date, await this.time.tzForBranch(branchId));
    const [sales, refunds, expenses] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          method: 'CASH',
          createdAt: range,
          order: { branchId },
        },
        _sum: { amount: true },
      }),
      this.prisma.refund.aggregate({
        where: {
          method: 'CASH',
          createdAt: range,
          order: { branchId },
        },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          branchId,
          spentOn: from,
          paidFromCash: true,
          status: 'APPROVED',
        },
        _sum: { amount: true },
      }),
    ]);
    const cashSales = Number(sales._sum.amount ?? 0);
    const cashRefunds = Number(refunds._sum.amount ?? 0);
    const cashExpenses = Number(expenses._sum.amount ?? 0);
    return {
      businessDate: date,
      openingFloat,
      cashSales: round2(cashSales - cashRefunds),
      cashExpenses: round2(cashExpenses),
      expectedCash: expectedCash(
        openingFloat,
        cashSales,
        cashRefunds,
        cashExpenses,
      ),
    };
  }

  async closeDay(branchId: string, userId: string, dto: CashClosingDto) {
    const existing = await this.prisma.cashClosing.findUnique({
      where: {
        branchId_businessDate: {
          branchId,
          businessDate: dayStart(dto.businessDate),
        },
      },
    });
    if (existing) throw new BadRequestException('This day is already closed');
    const p = await this.closingPreview(
      branchId,
      dto.businessDate,
      dto.openingFloat,
    );
    return this.prisma.cashClosing.create({
      data: {
        branchId,
        businessDate: dayStart(dto.businessDate),
        openingFloat: dto.openingFloat,
        cashSales: p.cashSales,
        cashExpenses: p.cashExpenses,
        expectedCash: p.expectedCash,
        countedCash: dto.countedCash,
        variance: round2(dto.countedCash - p.expectedCash),
        note: dto.note,
        closedById: userId,
      },
    });
  }

  listClosings(branchId: string) {
    return this.prisma.cashClosing.findMany({
      where: { branchId },
      orderBy: { businessDate: 'desc' },
      take: 60,
    });
  }

  // --- Reports -------------------------------------------------------------

  /** Profit & loss for a period (cash-basis on bills paid in the period). */
  async profitAndLoss(branchId: string, from: string, to: string) {
    const f = dayStart(from); // date columns (expenses, payroll periods)
    const t = dayAfter(to);
    const range = zonedRange(from, to, await this.time.tzForBranch(branchId));
    const [orders, refunds, expenses, runs] = await Promise.all([
      this.prisma.order.aggregate({
        where: { branchId, status: 'PAID', billedAt: range },
        _sum: { totalAmount: true, tipAmount: true, taxAmount: true },
        _count: { _all: true },
      }),
      this.prisma.refund.aggregate({
        where: { createdAt: range, order: { branchId } },
        _sum: { amount: true },
      }),
      this.prisma.expense.groupBy({
        by: ['category'],
        where: {
          branchId,
          status: 'APPROVED',
          spentOn: { gte: f, lt: t },
        },
        _sum: { amount: true },
        orderBy: { category: 'asc' },
      }),
      this.prisma.payrollRun.findMany({
        where: {
          branchId,
          // A run disappears from the P&L the moment it is paid if only
          // FINALIZED is selected. Approved runs stay a cost after payment.
          status: { in: ['FINALIZED', 'PAID'] },
          periodEnd: { gte: f, lt: t },
        },
        include: { lines: true },
      }),
    ]);

    // Tips belong to staff, not the restaurant, so they are excluded from
    // revenue (and from payroll cost below).
    const collected =
      Number(orders._sum.totalAmount ?? 0) - Number(orders._sum.tipAmount ?? 0);
    const tax = Number(orders._sum.taxAmount ?? 0);
    const refunded = Number(refunds._sum.amount ?? 0);
    const netSales = round2(collected - tax - refunded);
    const expenseRows = expenses.map((e) => ({
      category: e.category,
      amount: round2(Number(e._sum.amount ?? 0)),
    }));
    const totalExpenses = round2(expenseRows.reduce((s, e) => s + e.amount, 0));
    const payrollCost = round2(
      runs
        .flatMap((r) => r.lines)
        .reduce(
          // netPay is the authoritative figure after approved allowances,
          // bonus, late/absence and other deductions. Tips are staff money,
          // already excluded from revenue above, so exclude them here too.
          (s, l) => s + Number(l.netPay) - Number(l.tipShare),
          0,
        ),
    );
    return {
      from,
      to,
      orders: orders._count._all,
      grossCollected: round2(collected),
      taxCollected: round2(tax),
      refunds: round2(refunded),
      netSales,
      expenses: expenseRows,
      totalExpenses,
      payrollCost,
      netProfit: round2(netSales - totalExpenses - payrollCost),
    };
  }

  async gstReport(branchId: string, from: string, to: string) {
    const range = zonedRange(from, to, await this.time.tzForBranch(branchId));
    const [orders, refunds] = await Promise.all([
      this.prisma.order.findMany({
        where: { branchId, status: 'PAID', billedAt: range },
        select: {
          id: true,
          totalAmount: true,
          subtotal: true,
          discountAmount: true,
          loyaltyDiscountAmount: true,
          items: { select: { lineTotal: true, taxRateSnapshot: true } },
        },
      }),
      this.prisma.refund.groupBy({
        by: ['orderId'],
        where: { createdAt: range, order: { branchId } },
        _sum: { amount: true },
      }),
    ]);
    const refunded = new Map(
      refunds.map((r) => [r.orderId, Number(r._sum.amount ?? 0)]),
    );
    const lines = orders.flatMap((o) => {
      const subtotal = Number(o.subtotal);
      // Loyalty points are tender, not a price reduction: computeBill() keeps
      // them out of the stored tax, so reducing the taxable value here would
      // make this report disagree with what was actually charged on the bill.
      const charged = subtotal - Number(o.discountAmount);
      // A refund reverses the taxable sale for GST purposes just as it does
      // for P&L. Prorate every line by how much of this bill was refunded.
      const refundRatio = Math.min(
        1,
        (refunded.get(o.id) ?? 0) / Math.max(Number(o.totalAmount), 0.01),
      );
      const factor =
        (subtotal > 0 ? Math.max(0, charged) / subtotal : 1) *
        (1 - refundRatio);
      return o.items.map((i) => ({
        lineTotal: Number(i.lineTotal),
        taxRatePercent: Number(i.taxRateSnapshot),
        factor,
      }));
    });
    return { from, to, orders: orders.length, ...gstSummary(lines) };
  }

  /** Cross-branch snapshot for the whole restaurant. */
  async branchOverview(restaurantId: string, from: string, to: string) {
    const range = zonedRange(
      from,
      to,
      await this.time.tzForRestaurant(restaurantId),
    );
    const branches = await this.prisma.branch.findMany({
      where: { restaurantId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return Promise.all(
      branches.map(async (b) => {
        const [sales, open, ingredients] = await Promise.all([
          this.prisma.order.aggregate({
            where: {
              branchId: b.id,
              status: 'PAID',
              billedAt: range,
            },
            _sum: { totalAmount: true },
            _count: { _all: true },
          }),
          this.prisma.order.count({
            where: { branchId: b.id, status: 'OPEN' },
          }),
          this.prisma.ingredient.findMany({
            where: { branchId: b.id },
            select: {
              currentStock: true,
              reorderLevel: true,
              costPerUnit: true,
            },
          }),
        ]);
        return {
          branchId: b.id,
          name: b.name,
          orders: sales._count._all,
          sales: round2(Number(sales._sum.totalAmount ?? 0)),
          openOrders: open,
          lowStockItems: ingredients.filter(
            (i) =>
              Number(i.reorderLevel) > 0 &&
              Number(i.currentStock) <= Number(i.reorderLevel),
          ).length,
          inventoryValue: round2(
            ingredients.reduce(
              (s, i) => s + Number(i.currentStock) * Number(i.costPerUnit),
              0,
            ),
          ),
        };
      }),
    );
  }
}
