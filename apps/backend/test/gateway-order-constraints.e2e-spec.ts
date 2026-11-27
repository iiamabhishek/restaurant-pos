import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const run = process.env.FINANCIAL_HISTORY_E2E ? describe : describe.skip;

run('Gateway order references (PostgreSQL)', () => {
  const db = new PrismaClient();
  const provider = `test-${randomUUID()}`;
  let branchId: string;
  let restaurantId: string;
  let createdById: string;
  const createOrder = () =>
    db.order.create({
      data: {
        branchId,
        createdById,
        orderNumber: randomUUID(),
        status: 'CANCELLED',
      },
    });
  const payment = (orderId: string) => ({
    restaurantId,
    branchId,
    orderId,
    createdById,
    provider,
    mode: 'TEST' as const,
    amountMinor: 100,
    currency: 'USD',
  });
  const refund = (orderId: string) => ({
    restaurantId,
    gatewayPaymentId: randomUUID(),
    orderId,
    createdById,
    provider,
    amountMinor: 100,
    currency: 'USD',
  });

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({
      where: { email: 'owner@demo.local' },
    });
    restaurantId = user.restaurantId;
    createdById = user.id;
    branchId = (
      await db.branch.create({
        data: { restaurantId, name: 'Gateway history tests' },
      })
    ).id;
  });
  afterAll(async () => {
    try {
      if (branchId)
        await db.$transaction([
          db.gatewayRefund.deleteMany({ where: { provider } }),
          db.gatewayPayment.deleteMany({ where: { provider } }),
          db.order.deleteMany({ where: { branchId } }),
          db.branch.delete({ where: { id: branchId } }),
        ]);
    } finally {
      await db.$disconnect();
    }
  });

  it.each(['CREATED', 'SUCCEEDED', 'NEEDS_REVIEW'] as const)(
    'protects both ends of a %s gateway payment reference',
    async (status) => {
      const parent = await createOrder();
      await db.gatewayPayment.create({
        data: { ...payment(parent.id), status },
      });
      await expect(
        db.order.delete({ where: { id: parent.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });
      await expect(
        db.gatewayPayment.create({
          data: { ...payment(randomUUID()), status },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    },
  );

  it.each(['PENDING', 'SUCCEEDED', 'NEEDS_REVIEW'] as const)(
    'protects both ends of a %s gateway refund reference',
    async (status) => {
      const parent = await createOrder();
      await db.gatewayRefund.create({ data: { ...refund(parent.id), status } });
      await expect(
        db.order.delete({ where: { id: parent.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });
      await expect(
        db.gatewayRefund.create({ data: { ...refund(randomUUID()), status } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    },
  );

  it('cannot move a protected reference to a missing order or rename its parent', async () => {
    const parent = await createOrder();
    const row = await db.gatewayPayment.create({ data: payment(parent.id) });
    await expect(
      db.gatewayPayment.update({
        where: { id: row.id },
        data: { orderId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.order.update({ where: { id: parent.id }, data: { id: randomUUID() } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(
      await db.gatewayPayment.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({ orderId: parent.id });
  });

  it('accepts terminal attempts after deletion and rejects reactivation', async () => {
    const parent = await createOrder();
    const p = await db.gatewayPayment.create({
      data: { ...payment(parent.id), status: 'FAILED' },
    });
    const r = await db.gatewayRefund.create({
      data: { ...refund(parent.id), status: 'FAILED' },
    });
    await db.order.delete({ where: { id: parent.id } });
    await db.gatewayPayment.create({
      data: { ...payment(parent.id), status: 'EXPIRED' },
    });
    await db.gatewayRefund.create({
      data: { ...refund(parent.id), status: 'FAILED' },
    });
    await expect(
      db.gatewayPayment.update({
        where: { id: p.id },
        data: { status: 'CREATED' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.gatewayRefund.update({
        where: { id: r.id },
        data: { status: 'PENDING' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  // Hold the first transaction open until PostgreSQL confirms that the second
  // statement is waiting on it (or the unguarded statement already finished).
  async function race(
    first: (tx: Prisma.TransactionClient) => Promise<unknown>,
    second: () => Promise<unknown>,
  ) {
    let outcome: Promise<unknown> | undefined;
    await db.$transaction(async (tx) => {
      const [owner] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      await first(tx);
      let finished = false;
      outcome = second()
        .then(
          () => null,
          (error: unknown) => error,
        )
        .finally(() => {
          finished = true;
        });
      const deadline = Date.now() + 4000;
      while (!finished) {
        const [waiter] = await tx.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (SELECT FROM pg_locks
            WHERE NOT granted AND ${owner.pid} = ANY(pg_blocking_pids(pid))) AS waiting
        `;
        if (waiter.waiting) break;
        if (Date.now() >= deadline)
          throw new Error('Second transaction never reached the row lock');
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    });
    return outcome;
  }

  it('an uncommitted gateway insert wins against a concurrent order delete', async () => {
    const { id } = await createOrder();
    const outcome = await race(
      (tx) => tx.gatewayPayment.create({ data: payment(id) }),
      () => db.order.delete({ where: { id } }),
    );
    expect(outcome).toMatchObject({ code: 'P2003' });
    expect(await db.order.count({ where: { id } })).toBe(1);
  });

  it('an uncommitted order delete wins against a concurrent gateway refund insert', async () => {
    const { id } = await createOrder();
    const outcome = await race(
      (tx) => tx.order.delete({ where: { id } }),
      () => db.gatewayRefund.create({ data: refund(id) }),
    );
    expect(outcome).toMatchObject({ code: 'P2003' });
    expect(await db.gatewayRefund.count({ where: { orderId: id } })).toBe(0);
  });

  it.each(['RepeatableRead', 'Serializable'] as const)(
    'a %s delete with an older snapshot must retry after a new gateway reference',
    async (isolationLevel) => {
      const parent = await createOrder();
      await expect(
        db.$transaction(
          async (tx) => {
            await tx.order.findUniqueOrThrow({ where: { id: parent.id } });
            await db.gatewayRefund.create({ data: refund(parent.id) });
            await tx.order.delete({ where: { id: parent.id } });
          },
          { isolationLevel },
        ),
      ).rejects.toMatchObject({ code: 'P2034' });
      expect(await db.order.count({ where: { id: parent.id } })).toBe(1);
      const clean = await createOrder();
      await db.$transaction(
        (tx) => tx.order.delete({ where: { id: clean.id } }),
        { isolationLevel },
      );
    },
  );

  it('logs the gateway write for sync without publishing a synthetic order edit', async () => {
    const parent = await createOrder();
    const origin = randomUUID();
    const rollback = new Error('Roll back test sync settings');
    await expect(
      db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT sync_install_triggers()`;
        await tx.$executeRaw`UPDATE sync_state SET enabled = true WHERE id = 1`;
        await tx.$queryRaw`SELECT set_config('app.sync_origin', ${origin}, true)`;
        await tx.gatewayPayment.create({ data: payment(parent.id) });
        const changes = await tx.$queryRaw<{ tbl: string }[]>`
        SELECT tbl FROM sync_changes WHERE origin = ${origin} ORDER BY seq
      `;
        expect(changes).toEqual([{ tbl: 'gateway_payments' }]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
