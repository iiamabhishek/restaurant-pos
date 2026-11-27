/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-argument -- hand-built Prisma fakes */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersDuesService } from './orders-dues.service';

const customer = (n: number) => ({
  id: `c${n % 7}`,
  name: `Customer ${n % 7}`,
  phone: null,
});

function build(count: number, preview: (id: string) => Promise<unknown>) {
  const all = Array.from({ length: count }, (_, i) => ({
    id: `o${String(i).padStart(5, '0')}`,
    orderNumber: `N${i}`,
    type: 'DINE_IN',
    createdAt: new Date(2026, 0, 1, 0, 0, i),
    totalAmount: 100,
    customer: customer(i),
    payments: [],
  }));
  const findMany = jest.fn(
    async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
      const start = args.cursor
        ? all.findIndex((o) => o.id === args.cursor!.id) + (args.skip ?? 0)
        : 0;
      return all.slice(start, start + args.take);
    },
  );
  const prisma: any = { order: { findMany } };
  let inFlight = 0;
  let maxInFlight = 0;
  const orders: any = {
    previewBill: jest.fn(async (_b: string, id: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await preview(id);
      } finally {
        inFlight--;
      }
    }),
  };
  return {
    svc: new OrdersDuesService(prisma, orders),
    findMany,
    orders,
    maxInFlight: () => maxInFlight,
  };
}

const bill = (due: number, paid = 0) => ({ totalDue: due, amountPaid: paid });

describe('customer dues at scale', () => {
  it('totals cover every bill, bounded work, and the detail list says it is capped', async () => {
    const t = build(2500, async () => {
      await new Promise((r) => setImmediate(r));
      return bill(100, 40);
    });
    const res = await t.svc.list('b1', { rowLimit: 300 });
    expect(res.totalCount).toBe(2500);
    expect(res.totalOutstanding).toBe(2500 * 60);
    expect(res.rows).toHaveLength(300);
    expect(res.rowsTruncated).toBe(true);
    expect(res.rowLimit).toBe(300);
    // Every customer's owed adds back up to the grand total: nothing dropped.
    expect(res.customers.reduce((s, c) => s + c.owed, 0)).toBe(2500 * 60);
    // Batches, not one giant read; concurrency stays bounded.
    expect(t.findMany.mock.calls.length).toBeGreaterThan(10);
    expect(t.findMany.mock.calls.every(([a]) => a.take <= 200)).toBe(true);
    expect(t.maxInFlight()).toBeLessThanOrEqual(6);
    expect(t.orders.previewBill).toHaveBeenCalledTimes(2500);
  });

  it('a small result is not flagged as truncated', async () => {
    const t = build(5, async () => bill(50));
    const res = await t.svc.list('b1');
    expect(res.rowsTruncated).toBe(false);
    expect(res.rows).toHaveLength(5);
  });

  it('skips an order cancelled or deleted mid-scan, but fails on any other error', async () => {
    const skip = build(10, async (id) => {
      if (id === 'o00003') throw new NotFoundException('gone');
      if (id === 'o00004') throw new BadRequestException('Order is cancelled');
      return bill(10);
    });
    const res = await skip.svc.list('b1');
    expect(res.totalCount).toBe(8);
    expect(res.totalOutstanding).toBe(80);

    const broken = build(10, async (id) => {
      if (id === 'o00005') throw new Error('database timeout');
      return bill(10);
    });
    await expect(broken.svc.list('b1')).rejects.toThrow('database timeout');
  });

  it('fully paid and zero-balance bills are not dues; partial and unpaid are told apart', async () => {
    const t = build(4, async (id) =>
      id === 'o00000'
        ? bill(100, 100)
        : id === 'o00001'
          ? bill(100, 0)
          : id === 'o00002'
            ? bill(100, 99.999)
            : bill(100, 30),
    );
    const res = await t.svc.list('b1');
    expect(res.totalCount).toBe(2);
    expect(res.rows.map((r) => r.status).sort()).toEqual(['PARTIAL', 'UNPAID']);
    expect(res.totalOutstanding).toBe(170);
  });

  it('rowLimit is clamped to a sane range', async () => {
    const t = build(3, async () => bill(10));
    expect((await t.svc.list('b1', { rowLimit: 0 })).rowLimit).toBe(1);
    expect((await t.svc.list('b1', { rowLimit: 99999 })).rowLimit).toBe(2000);
  });
});
