import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BranchTimeService } from '../../common/services/branch-time.service';
import { zonedRange } from '../../common/time';
import { PrismaService } from '../../prisma/prisma.service';
import {
  checkInvoice,
  computeVariance,
  type ReceiptLine,
} from './price-variance';

const ROW_CAP = 2000;

@Injectable()
export class PriceVarianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: BranchTimeService,
  ) {}

  async report(
    branchId: string,
    from: string,
    to: string,
    opts: { supplierId?: string; thresholdPct?: number } = {},
  ) {
    const threshold = opts.thresholdPct ?? 5;
    if (!(threshold >= 0 && threshold <= 1000))
      throw new BadRequestException('threshold must be between 0 and 1000');
    const range = zonedRange(from, to, await this.time.tzForBranch(branchId));

    const inWindow = await this.prisma.goodsReceiptItem.findMany({
      where: {
        goodsReceipt: {
          branchId,
          receivedAt: range,
          ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
        },
      },
      include: {
        goodsReceipt: { include: { supplier: { select: { name: true } } } },
        ingredient: { select: { name: true, unit: true } },
        purchaseOrderItem: { select: { unitCost: true } },
      },
      orderBy: { goodsReceipt: { receivedAt: 'asc' } },
      take: ROW_CAP + 1,
    });
    const truncated = inWindow.length > ROW_CAP;
    if (truncated) inWindow.pop();

    // "Last price" needs the earlier receipts of the same items, including those before the window.
    const ingredientIds = [...new Set(inWindow.map((i) => i.ingredientId))];
    const history = ingredientIds.length
      ? await this.prisma.goodsReceiptItem.findMany({
          where: {
            ingredientId: { in: ingredientIds },
            goodsReceipt: { branchId, receivedAt: { lt: range.lt } },
          },
          include: {
            goodsReceipt: { include: { supplier: { select: { name: true } } } },
            ingredient: { select: { name: true, unit: true } },
            purchaseOrderItem: { select: { unitCost: true } },
          },
        })
      : [];
    type Row = (typeof inWindow)[number];
    const toLine = (i: Row): ReceiptLine => ({
      id: i.id,
      grnNumber: i.goodsReceipt.grnNumber,
      receivedAt: i.goodsReceipt.receivedAt,
      supplierName: i.goodsReceipt.supplier.name,
      ingredientId: i.ingredientId,
      ingredientName: i.ingredient.name,
      unit: i.ingredient.unit,
      quantity: i.quantity,
      unitCost: i.unitCost,
      poUnitCost: i.purchaseOrderItem?.unitCost ?? null,
    });
    const lines = computeVariance(
      inWindow.map(toLine),
      history.map(toLine),
      threshold,
    );

    // Receipt value against the supplier invoice recorded for it.
    const receiptIds = [...new Set(inWindow.map((i) => i.goodsReceiptId))];
    const invoices = receiptIds.length
      ? await this.prisma.supplierInvoice.findMany({
          where: {
            branchId,
            goodsReceiptId: { in: receiptIds },
            status: { not: 'CANCELLED' },
          },
          select: {
            goodsReceiptId: true,
            invoiceNumber: true,
            totalAmount: true,
          },
        })
      : [];
    const grnById = new Map(
      inWindow.map((i) => [i.goodsReceiptId, i.goodsReceipt]),
    );
    const invoiceChecks = invoices.map((inv) => {
      const grn = grnById.get(inv.goodsReceiptId as string)!;
      return checkInvoice(
        {
          grnNumber: grn.grnNumber,
          supplierName: grn.supplier.name,
          lines: inWindow
            .filter((i) => i.goodsReceiptId === inv.goodsReceiptId)
            .map((i) => ({ quantity: i.quantity, unitCost: i.unitCost })),
        },
        inv,
        threshold,
      );
    });

    const extra = lines.reduce(
      (a, l) => a.plus(l.poVarianceAmount ?? 0),
      new Prisma.Decimal(0),
    );
    return {
      thresholdPct: threshold,
      truncated,
      lines,
      invoiceChecks,
      summary: {
        flaggedLines: lines.filter((l) => l.flagged).length,
        flaggedInvoices: invoiceChecks.filter((c) => c.flagged).length,
        paidAboveOrderPrice: extra.toFixed(2),
      },
    };
  }
}
