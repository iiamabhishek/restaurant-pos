import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const run = process.env.FINANCIAL_HISTORY_E2E ? describe : describe.skip;

run('Customer financial history (PostgreSQL)', () => {
  const branchId = 'demo-branch';
  const customerId = randomUUID();
  const orderId = randomUUID();
  const cardCode = randomUUID();
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$transaction([
        prisma.pointsLedger.deleteMany({ where: { orderId } }),
        prisma.order.deleteMany({ where: { id: orderId } }),
        prisma.giftCard.deleteMany({ where: { code: cardCode } }),
        prisma.customer.deleteMany({ where: { id: customerId } }),
      ]);
    }
    await app?.close();
  });

  it('detaches the customer while retaining the points entry, paid order and gift card balance', async () => {
    const { userId } = await prisma.userBranch.findFirstOrThrow({
      where: { branchId },
    });
    const { pointsLedger, orders, giftCards } = await prisma.customer.create({
      data: {
        id: customerId,
        branchId,
        loyaltyPoints: 3,
        orders: {
          create: {
            id: orderId,
            orderNumber: orderId,
            branchId,
            createdById: userId,
            status: 'PAID',
            totalAmount: 300,
          },
        },
        giftCards: {
          create: { branchId, code: cardCode, initialValue: 50, balance: 15 },
        },
        pointsLedger: {
          create: {
            branchId,
            orderId,
            delta: 3,
            reason: 'EARN',
            idempotencyKey: `earn:${orderId}`,
          },
        },
      },
      include: { pointsLedger: true, orders: true, giftCards: true },
    });

    await owner
      .delete(`/api/v1/customers/${customerId}?branchId=${branchId}`)
      .expect(200);

    expect(
      await prisma.customer.findUnique({ where: { id: customerId } }),
    ).toBeNull();
    expect(await prisma.pointsLedger.findMany({ where: { orderId } })).toEqual([
      { ...pointsLedger[0], customerId: null },
    ]);
    expect(
      await prisma.order.findUnique({ where: { id: orderId } }),
    ).toMatchObject({
      customerId: null,
      status: 'PAID',
      totalAmount: orders[0].totalAmount,
    });
    expect(
      await prisma.giftCard.findUnique({ where: { code: cardCode } }),
    ).toMatchObject({
      customerId: null,
      balance: giftCards[0].balance,
    });
  });
});
