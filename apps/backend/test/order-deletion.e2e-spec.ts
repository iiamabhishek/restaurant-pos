import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { SessionUser } from '@nodedr-restaurant/types';
import type {
  GatewayPaymentStatus,
  GatewayRefundStatus,
  OrderStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { OrdersService } from '../src/modules/orders/orders.service';
import { stripeAdapter } from '../src/payment-gateways/adapters/stripe.adapter';
import { GatewayPaymentsService } from '../src/payment-gateways/gateway-payments.service';
import { PrismaService } from '../src/prisma/prisma.service';

const run = process.env.ORDER_DELETION_E2E ? describe : describe.skip;

run('Finished order deletion', () => {
  let app: INestApplication<App>;
  let db: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let user: SessionUser;
  let branchId: string;
  const password = 'Password123!';
  const provider = 'stripe';
  const order = (status: OrderStatus = 'CANCELLED', deliveryFee = 0) =>
    db.order.create({
      data: {
        branchId,
        createdById: user.id,
        deliveryFee,
        status,
        orderNumber: randomUUID(),
      },
    });
  const remove = (orderIds: string[], suppliedPassword = password) =>
    owner
      .post(`/api/v1/orders/delete-bulk?branchId=${branchId}`)
      .send({ orderIds, password: suppliedPassword });
  const history = (orderId: string) => ({
    orderId,
    restaurantId: user.restaurantId,
    createdById: user.id,
    provider,
    currency: 'USD',
    amountMinor: 100,
  });
  const payment = (orderId: string, status: GatewayPaymentStatus) =>
    db.gatewayPayment.create({
      data: {
        ...history(orderId),
        branchId,
        mode: 'TEST',
        status,
        providerRef: randomUUID(),
      },
    });
  const refund = (
    orderId: string,
    gatewayPaymentId: string,
    status: GatewayRefundStatus,
  ) =>
    db.gatewayRefund.create({
      data: { ...history(orderId), gatewayPaymentId, status },
    });
  const audits = (ids: string[]) =>
    db.auditLog.findMany({
      where: { action: 'order.deleted', entityId: { in: ids } },
    });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: () =>
          Promise.resolve({
            totalHits: 1,
            timeToExpire: 60,
            isBlocked: false,
            timeToBlockExpire: 0,
          }),
      })
      .compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get(PrismaService);
    owner = request.agent(app.getHttpServer());
    const prior = process.env.ALLOW_PUBLIC_SIGNUP;
    process.env.ALLOW_PUBLIC_SIGNUP = 'true';
    try {
      const response = await owner
        .post('/api/v1/auth/register')
        .send({
          ownerName: 'Order history owner',
          email: `order-history-${randomUUID()}@example.com`,
          password,
          restaurantName: 'Order history',
          branchName: 'Main',
        })
        .expect(201);
      user = (response.body as { user: SessionUser }).user;
    } finally {
      if (prior === undefined) delete process.env.ALLOW_PUBLIC_SIGNUP;
      else process.env.ALLOW_PUBLIC_SIGNUP = prior;
    }
    branchId = (
      await db.branch.findFirstOrThrow({
        where: { restaurantId: user.restaurantId },
      })
    ).id;
    await db.paymentGatewayConnection.create({
      data: {
        restaurantId: user.restaurantId,
        provider,
        country: 'US',
        testKeys: ['secretKey', 'webhookSecret'],
      },
    });
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app.close());

  it.each(['payment', 'refund'] as const)(
    'keeps a paid order and its local %s',
    async (kind) => {
      const { id } = await order('PAID');
      const data = {
        orderId: id,
        method: 'CASH' as const,
        amount: 1,
        createdById: user.id,
      };
      if (kind === 'payment') await db.payment.create({ data });
      else await db.refund.create({ data });
      await remove([id]).expect(409);
      expect(await db.order.count({ where: { id } })).toBe(1);
      const count =
        kind === 'payment'
          ? await db.payment.count({ where: { orderId: id } })
          : await db.refund.count({ where: { orderId: id } });
      expect(count).toBe(1);
      expect(await audits([id])).toHaveLength(0);
    },
  );

  it.each(['CREATED', 'SUCCEEDED', 'NEEDS_REVIEW'] as const)(
    'rejects a mixed batch with a %s gateway payment atomically',
    async (status) => {
      const clean = await order();
      const protectedOrder = await order();
      await payment(protectedOrder.id, status);
      const ids = [clean.id, protectedOrder.id];
      await remove(ids).expect(409);
      expect(await db.order.count({ where: { id: { in: ids } } })).toBe(2);
      expect(await audits(ids)).toHaveLength(0);
    },
  );

  it.each(['PENDING', 'SUCCEEDED', 'NEEDS_REVIEW'] as const)(
    'keeps a cancelled order with an unlinked %s gateway refund',
    async (status) => {
      const { id } = await order();
      const attempt = await payment(id, 'FAILED');
      const row = await refund(id, attempt.id, status);
      await remove([id]).expect(409);
      expect(await db.order.count({ where: { id } })).toBe(1);
      expect(
        await db.gatewayRefund.findUnique({ where: { id: row.id } }),
      ).toMatchObject({ orderId: id, status });
    },
  );

  it('deletes clean finished orders once and retains their audit snapshots', async () => {
    const paid = await order('PAID');
    const cancelled = await order();
    const attempt = await payment(cancelled.id, 'FAILED');
    await payment(cancelled.id, 'EXPIRED');
    await refund(cancelled.id, attempt.id, 'FAILED');
    const ids = [paid.id, cancelled.id];
    await remove([...ids, paid.id]).expect(201, { deleted: 2 });
    expect(await db.order.count({ where: { id: { in: ids } } })).toBe(0);
    const logs = await audits(ids);
    expect(logs).toHaveLength(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: cancelled.id,
          userId: user.id,
          metadata: expect.objectContaining({
            orderNumber: cancelled.orderNumber,
            status: 'CANCELLED',
            payments: [],
          }) as unknown,
        }),
      ]),
    );
  });

  it('retains password, status, branch and fiscal checks', async () => {
    const finished = await order();
    await remove([finished.id], 'wrong').expect(403);
    const open = await order('OPEN');
    await remove([finished.id, open.id]).expect(400);
    const other = await db.branch.create({
      data: { restaurantId: user.restaurantId, name: 'Other' },
    });
    const outside = await db.order.create({
      data: {
        branchId: other.id,
        createdById: user.id,
        orderNumber: randomUUID(),
        status: 'PAID',
      },
    });
    await remove([finished.id, outside.id]).expect(404);
    await db.verifactuRecord.create({
      data: {
        restaurantId: user.restaurantId,
        branchId,
        orderId: finished.id,
        issuerNif: 'TEST',
        seq: 1,
        type: 'ALTA',
        invoiceType: 'F2',
        invoiceNumber: '1',
        issueDate: '01-01-2026',
        taxTotalCents: 0,
        totalCents: 0,
        generatedAt: new Date().toISOString(),
        hash: 'test',
        xml: '<test/>',
        environment: 'TEST',
      },
    });
    await remove([finished.id]).expect(400);
    expect(await db.order.count({ where: { id: finished.id } })).toBe(1);
    expect(await audits([finished.id])).toHaveLength(0);
  });

  it('cannot reserve a payment link for an order deleted after the bill was read', async () => {
    const { id } = await order('OPEN', 1);
    const orders = app.get(OrdersService);
    const bill = await orders.previewBill(branchId, id, {});
    jest.spyOn(orders, 'previewBill').mockImplementationOnce(async () => {
      await db.order.update({ where: { id }, data: { status: 'CANCELLED' } });
      await remove([id]).expect(201);
      return bill;
    });
    const providerCall = jest
      .spyOn(stripeAdapter, 'createPayment')
      .mockResolvedValue({
        providerRef: randomUUID(),
        checkoutUrl: 'https://example.com/pay',
      });
    await expect(
      app
        .get(GatewayPaymentsService)
        .create(user.restaurantId, branchId, id, user.id, {}),
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.gatewayPayment.count({ where: { orderId: id } })).toBe(0);
    expect(providerCall).not.toHaveBeenCalled();
  });

  it('rejects deletion while the provider is still creating a reserved payment link', async () => {
    const { id } = await order('OPEN', 1);
    jest
      .spyOn(stripeAdapter, 'createPayment')
      .mockImplementationOnce(async () => {
        await db.order.update({ where: { id }, data: { status: 'CANCELLED' } });
        await remove([id]).expect(409);
        return {
          providerRef: randomUUID(),
          checkoutUrl: 'https://example.com/pay',
        };
      });
    await expect(
      app
        .get(GatewayPaymentsService)
        .create(user.restaurantId, branchId, id, user.id, {}),
    ).resolves.toMatchObject({ orderId: id, status: 'CREATED' });
    expect(await db.order.count({ where: { id } })).toBe(1);
    expect(await audits([id])).toHaveLength(0);
  });

  it.each([100, 120])(
    'a late provider response for %i cents cannot revive an expired payment after deletion',
    async (paidMinor) => {
      const { id } = await order();
      const attempt = await payment(id, 'CREATED');
      jest
        .spyOn(stripeAdapter, 'fetchStatus')
        .mockImplementationOnce(async () => {
          await db.gatewayPayment.update({
            where: { id: attempt.id },
            data: { status: 'EXPIRED' },
          });
          await remove([id]).expect(201);
          return {
            state: 'PAID',
            currency: 'USD',
            requestedMinor: 100,
            paidMinor,
          };
        });
      const current = await app.get(GatewayPaymentsService).refresh(attempt.id);
      expect(current.status).toBe('EXPIRED');
      expect(
        await db.gatewayPayment.findUniqueOrThrow({
          where: { id: attempt.id },
        }),
      ).toMatchObject({ status: 'EXPIRED' });
    },
  );

  it('a late expiry cannot release a confirmed payment for deletion', async () => {
    const { id } = await order();
    const attempt = await payment(id, 'CREATED');
    jest
      .spyOn(stripeAdapter, 'fetchStatus')
      .mockImplementationOnce(async () => {
        await db.gatewayPayment.update({
          where: { id: attempt.id },
          data: { status: 'SUCCEEDED' },
        });
        return {
          state: 'EXPIRED',
          currency: 'USD',
          requestedMinor: 100,
          paidMinor: 0,
        };
      });
    expect(
      (await app.get(GatewayPaymentsService).refresh(attempt.id)).status,
    ).toBe('SUCCEEDED');
    await remove([id]).expect(409);
  });

  it('a late reconciliation cannot reopen a failed refund after deletion', async () => {
    const { id } = await order();
    const attempt = await payment(id, 'FAILED');
    const row = await refund(id, attempt.id, 'PENDING');
    const remoteId = 're_1';
    await db.gatewayRefund.update({
      where: { id: row.id },
      data: {
        providerRefundId: remoteId,
        createdAt: new Date(Date.now() - 20 * 60_000),
      },
    });
    jest
      .spyOn(stripeAdapter, 'fetchRefundStatus')
      .mockImplementationOnce(async () => {
        await db.gatewayRefund.update({
          where: { id: row.id },
          data: { status: 'FAILED' },
        });
        await remove([id]).expect(201);
        return { state: 'DONE', providerRefundId: remoteId };
      });
    await app
      .get(GatewayPaymentsService)
      .refundsNeedingReview(user.restaurantId);
    expect(
      await db.gatewayRefund.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({ status: 'FAILED' });
  });
});
