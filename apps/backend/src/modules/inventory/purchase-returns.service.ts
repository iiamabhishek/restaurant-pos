import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PurchaseReturnDto } from '@nodedr-restaurant/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from './stock.service';

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);

/**
 * Goods sent back to a supplier. One transaction does everything or nothing: it takes the quantity out of stock,
 * writes the return, and credits the value (quantity x the price paid on that receipt) against an unpaid invoice.
 * The part the invoice cannot absorb stays as an open credit on the supplier. A return can never exceed what the
 * receipt brought in minus what was already returned, and a repeated clientRequestId answers with the first result.
 */
@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  list(branchId: string, supplierId?: string) {
    return this.prisma.purchaseReturn.findMany({
      where: { branchId, ...(supplierId ? { supplierId } : {}) },
      include: {
        supplier: { select: { id: true, name: true } },
        goodsReceipt: { select: { id: true, grnNumber: true } },
        items: {
          include: { ingredient: { select: { name: true, unit: true } } },
        },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async create(branchId: string, userId: string, dto: PurchaseReturnDto) {
    if (dto.clientRequestId) {
      const prior = await this.prisma.purchaseReturn.findUnique({
        where: { clientRequestId: dto.clientRequestId },
        include: { items: true },
      });
      if (prior)
        return prior.branchId === branchId
          ? prior
          : (() => {
              throw new ConflictException('That request id was already used');
            })();
    }
    try {
      return await this.prisma.$transaction(
        (tx) => this.post(tx, branchId, userId, dto),
        { timeout: 30_000 },
      );
    } catch (e) {
      if (
        dto.clientRequestId &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const winner = await this.prisma.purchaseReturn.findUnique({
          where: { clientRequestId: dto.clientRequestId },
          include: { items: true },
        });
        if (winner?.branchId === branchId) return winner;
      }
      throw e;
    }
  }

  private async post(
    tx: Prisma.TransactionClient,
    branchId: string,
    userId: string,
    dto: PurchaseReturnDto,
  ) {
    // Two returns on one receipt at once must see each other's quantities.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pr-grn:${dto.goodsReceiptId}`}))`;
    const grn = await tx.goodsReceipt.findFirst({
      where: { id: dto.goodsReceiptId, branchId },
      include: { items: true },
    });
    if (!grn) throw new NotFoundException('Goods receipt not found');

    // The same line twice in one request would dodge the cap below, so merge them first.
    const wanted = new Map<string, Prisma.Decimal>();
    for (const l of dto.items)
      wanted.set(
        l.goodsReceiptItemId,
        (wanted.get(l.goodsReceiptItemId) ?? D(0)).plus(D(l.quantity)),
      );

    const byId = new Map(grn.items.map((i) => [i.id, i]));
    const already = await tx.purchaseReturnItem.groupBy({
      by: ['goodsReceiptItemId'],
      where: { goodsReceiptItemId: { in: [...wanted.keys()] } },
      _sum: { quantity: true },
    });
    const returned = new Map(
      already.map((r) => [r.goodsReceiptItemId, r._sum.quantity ?? D(0)]),
    );

    let total = D(0);
    const lines: {
      goodsReceiptItemId: string;
      ingredientId: string;
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
    }[] = [];
    for (const [itemId, qty] of wanted) {
      const gi = byId.get(itemId);
      if (!gi)
        throw new BadRequestException('A line is not part of that receipt');
      const left = D(gi.quantity).minus(returned.get(itemId) ?? D(0));
      if (qty.gt(left))
        throw new BadRequestException(
          `Only ${left.toString()} of this item can still be returned from ${grn.grnNumber}`,
        );
      total = total.plus(qty.mul(gi.unitCost).toDecimalPlaces(2));
      lines.push({
        goodsReceiptItemId: itemId,
        ingredientId: gi.ingredientId,
        quantity: qty,
        unitCost: D(gi.unitCost),
      });
    }

    const returnNumber = await this.nextNumber(tx, branchId);
    for (const l of lines) {
      // Throws (and rolls everything back) when the stock is no longer there to send back.
      await this.stock.consumeStock(tx, branchId, l.ingredientId, l.quantity, {
        type: 'PURCHASE_RETURN',
        note: `Return ${returnNumber} to supplier (${grn.grnNumber}): ${dto.reason}`,
        userId,
        allowNegative: false,
      });
    }

    const { invoiceId, applied } = await this.credit(
      tx,
      branchId,
      grn.id,
      dto.invoiceId,
      total,
    );
    return tx.purchaseReturn.create({
      data: {
        branchId,
        supplierId: grn.supplierId,
        goodsReceiptId: grn.id,
        returnNumber,
        reason: dto.reason,
        notes: dto.notes,
        totalAmount: total,
        creditedInvoiceId: invoiceId,
        creditApplied: applied,
        creditOpen: total.minus(applied),
        createdById: userId,
        clientRequestId: dto.clientRequestId,
        items: { create: lines },
      },
      include: { items: true },
    });
  }

  /** Put the credit against an unpaid invoice (the chosen one, else the receipt's); the rest stays open. */
  private async credit(
    tx: Prisma.TransactionClient,
    branchId: string,
    goodsReceiptId: string,
    invoiceId: string | undefined,
    total: Prisma.Decimal,
  ) {
    const invoice = await tx.supplierInvoice.findFirst({
      where: invoiceId
        ? { id: invoiceId, branchId, status: { not: 'CANCELLED' } }
        : { goodsReceiptId, branchId, status: { not: 'CANCELLED' } },
      orderBy: { invoiceDate: 'asc' },
    });
    if (invoiceId && !invoice)
      throw new BadRequestException('Invoice not found or cancelled');
    if (!invoice) return { invoiceId: null, applied: D(0) };
    await tx.$queryRaw`SELECT id FROM supplier_invoices WHERE id = ${invoice.id} FOR UPDATE`;
    const fresh = await tx.supplierInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    const owed = D(fresh.totalAmount)
      .minus(fresh.amountPaid)
      .minus(fresh.creditedAmount);
    const applied = Prisma.Decimal.min(total, owed.isNegative() ? D(0) : owed);
    if (applied.gt(0)) {
      const credited = D(fresh.creditedAmount).plus(applied);
      const settled = D(fresh.amountPaid).plus(credited);
      await tx.supplierInvoice.update({
        where: { id: fresh.id },
        data: {
          creditedAmount: credited,
          status: settled.gte(fresh.totalAmount)
            ? 'PAID'
            : settled.gt(0)
              ? 'PARTIALLY_PAID'
              : 'UNPAID',
        },
      });
    }
    return { invoiceId: fresh.id, applied };
  }

  private async nextNumber(tx: Prisma.TransactionClient, branchId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pr:${branchId}`}))`;
    const last = await tx.purchaseReturn.findFirst({
      where: { branchId },
      orderBy: { returnNumber: 'desc' },
      select: { returnNumber: true },
    });
    const seq = last ? Number(last.returnNumber.split('-')[1] ?? 0) + 1 : 1;
    return `PR-${String(seq).padStart(4, '0')}`;
  }

  /** What we owe a supplier: unpaid invoice balances minus the credit still open from returns. */
  async supplierBalance(branchId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, branchId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    const [invoices, returns] = await Promise.all([
      this.prisma.supplierInvoice.findMany({
        where: { branchId, supplierId, status: { not: 'CANCELLED' } },
        select: { totalAmount: true, amountPaid: true, creditedAmount: true },
      }),
      this.prisma.purchaseReturn.aggregate({
        where: { branchId, supplierId },
        _sum: { creditOpen: true },
      }),
    ]);
    const invoiced = invoices.reduce(
      (a, i) =>
        a.plus(i.totalAmount).minus(i.amountPaid).minus(i.creditedAmount),
      D(0),
    );
    const openCredit = returns._sum.creditOpen ?? D(0);
    return {
      supplier,
      invoicesOutstanding: invoiced.toFixed(2),
      openCredit: openCredit.toFixed(2),
      owed: invoiced.minus(openCredit).toFixed(2),
    };
  }
}
