import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { round2 } from '../../common/money';
import { OrdersService } from './orders.service';

export type DuesStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OUTSTANDING';

const BATCH_SIZE = 200;
const PREVIEW_CONCURRENCY = 6;

export interface DuesFilters {
  /** Cap on the detail list only; totals always cover every due. Default 500, max 2000. */
  rowLimit?: number;
  status?: DuesStatus;
  customerId?: string;
  from?: Date;
  to?: Date;
}

export interface DueRow {
  orderId: string;
  orderNumber: string;
  type: string;
  createdAt: Date;
  customer: { id: string; name: string | null; phone: string | null };
  total: number;
  paid: number;
  balance: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  payments: { id: string; method: string; amount: number; at: Date }[];
}

// An open bill left with a named customer who owes money. Unpaid and part-paid
// bills stay OPEN (the existing checkout records each payment against the bill,
// idempotently, and never closes a short one), so the ledger is a read-only view
// over those orders: nothing here moves money or changes a bill.
@Injectable()
export class OrdersDuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  /**
   * Dues across EVERY matching order, without an unbounded workload.
   *
   * Totals and the per-customer table always cover every due. Only the detail
   * `rows` list is capped (`rowLimit`, oldest first); the response says so with
   * `rowsTruncated` and `totalCount`, so a caller never mistakes a page for the
   * whole. Orders are read in keyset-paginated batches and bill previews run
   * with a small fixed concurrency, so the database and the pricing engine see
   * a steady, bounded load however many open bills exist.
   *
   * Each preview is a point-in-time read: a bill paid or changed while the scan
   * runs is reflected as of its own preview. An order that vanished or was
   * cancelled mid-scan is skipped; any other failure fails the request, because
   * returning a smaller total than the truth is worse than returning an error.
   */
  async list(branchId: string, f: DuesFilters = {}) {
    const wantPaid = f.status === 'PAID';
    const rowLimit = Math.min(Math.max(f.rowLimit ?? 500, 1), 2000);
    const where = {
      branchId,
      customerId: f.customerId ?? { not: null },
      status: wantPaid ? ('PAID' as const) : ('OPEN' as const),
      ...(f.from || f.to ? { createdAt: { gte: f.from, lte: f.to } } : {}),
    };

    const out: DueRow[] = [];
    let totalCount = 0;
    let totalOutstanding = 0;
    const byCustomer = new Map<
      string,
      {
        customerId: string;
        name: string | null;
        phone: string | null;
        bills: number;
        owed: number;
        oldest: Date;
      }
    >();

    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.order.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          payments: {
            select: { id: true, method: true, amount: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;

      const previews = new Map<
        string,
        Awaited<ReturnType<OrdersService['previewBill']>> | null
      >();
      if (!wantPaid) await this.previewAll(branchId, batch, previews);

      for (const o of batch) {
        if (!o.customer) continue;
        let total: number;
        let paid: number;
        const payments = o.payments.map((p) => ({
          id: p.id,
          method: p.method,
          amount: Number(p.amount),
          at: p.createdAt,
        }));
        if (wantPaid) {
          total = Number(o.totalAmount);
          paid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
        } else {
          const view = previews.get(o.id);
          if (!view) continue;
          // The exact bill as it would settle now (tax, discounts, tip), not the stored subtotal.
          total = view.totalDue;
          paid = view.amountPaid;
        }
        const balance = wantPaid ? 0 : Math.max(round2(total - paid), 0);
        if (!wantPaid && balance <= 0.004) continue;
        const status = wantPaid ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
        if (f.status === 'UNPAID' && status !== 'UNPAID') continue;
        if (f.status === 'PARTIAL' && status !== 'PARTIAL') continue;

        totalCount += 1;
        totalOutstanding = round2(totalOutstanding + balance);
        if (balance > 0) {
          const c = byCustomer.get(o.customer.id) ?? {
            customerId: o.customer.id,
            name: o.customer.name,
            phone: o.customer.phone,
            bills: 0,
            owed: 0,
            oldest: o.createdAt,
          };
          c.bills += 1;
          c.owed = round2(c.owed + balance);
          if (o.createdAt < c.oldest) c.oldest = o.createdAt;
          byCustomer.set(o.customer.id, c);
        }
        if (out.length < rowLimit) {
          out.push({
            orderId: o.id,
            orderNumber: o.orderNumber,
            type: o.type,
            createdAt: o.createdAt,
            customer: o.customer,
            total,
            paid,
            balance,
            status,
            payments,
          });
        }
      }
      if (batch.length < BATCH_SIZE) break;
    }

    return {
      rows: out,
      rowsTruncated: totalCount > out.length,
      rowLimit,
      totalOutstanding,
      totalCount,
      customers: [...byCustomer.values()].sort((a, b) => b.owed - a.owed),
    };
  }

  /** Bill previews with at most PREVIEW_CONCURRENCY in flight at once. */
  private async previewAll(
    branchId: string,
    batch: { id: string }[],
    previews: Map<
      string,
      Awaited<ReturnType<OrdersService['previewBill']>> | null
    >,
  ) {
    let next = 0;
    const worker = async () => {
      while (next < batch.length) {
        const o = batch[next++];
        try {
          previews.set(o.id, await this.orders.previewBill(branchId, o.id, {}));
        } catch (err) {
          // Only an order that vanished or was cancelled can be skipped; any
          // other failure must fail the request, not understate dues.
          if (
            err instanceof NotFoundException ||
            (err instanceof BadRequestException && /cancel/i.test(err.message))
          ) {
            previews.set(o.id, null);
            continue;
          }
          throw err;
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(PREVIEW_CONCURRENCY, batch.length) },
        worker,
      ),
    );
  }
}
