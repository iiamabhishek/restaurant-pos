/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped by design */
// Gift-card refunds against a REAL Postgres: the refund record and the card
// credit must always agree, mixed tender is capped at what the card paid, and
// concurrent refunds cannot over-credit. Opt-in:
//   GIFT_REFUND_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand gift-card-refund
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.GIFT_REFUND_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);

run('Gift-card refunds (e2e, real Postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let agent: ReturnType<typeof request.agent>;
  let floorId: string;
  let itemId: string; // 100.00, no tax
  let seq = 0;

  const post = (p: string, b?: object) => agent.post(`/api/v1${p}`).send(b);
  const get = (p: string) => agent.get(`/api/v1${p}`);
  const card = async (value: number) =>
    (await post(`/gift-cards${q}`, { initialValue: value }).expect(201))
      .body as {
      id: string;
      code: string;
    };
  const balance = async (id: string) =>
    Number(
      (await prisma.giftCard.findUniqueOrThrow({ where: { id } })).balance,
    );
  /** Bill 100 paid `fromCard` by gift card and the rest by cash. */
  const paidOrder = async (cardCode: string | null, fromCard: number) => {
    const t = await post(`/tables${q}`, {
      floorId,
      number: `G${++seq}-${tag}`,
      capacity: 2,
    }).expect(201);
    const o = await post(`/orders${q}`, {
      type: 'DINE_IN',
      tableId: t.body.id,
      items: [{ menuItemId: itemId, quantity: 1, modifierIds: [] }],
    }).expect(201);
    await post(`/orders/${o.body.id}/checkout${q}`, {
      requestId: randomUUID(),
      ...(cardCode ? { giftCardCode: cardCode } : {}),
      payments:
        fromCard < 100 ? [{ method: 'CASH', amount: 100 - fromCard }] : [],
    }).expect(201);
    return o.body.id as string;
  };
  const refund = (id: string, amount: number, method = 'GIFT_CARD') =>
    post(`/orders/${id}/refund${q}`, { amount, method, reason: 'test refund' });
  const refunded = async (id: string) =>
    (await prisma.refund.findMany({ where: { orderId: id } })).reduce(
      (s, r) => s + Number(r.amount),
      0,
    );

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
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();
    prisma = app.get(PrismaService);
    agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    floorId = (await get(`/tables/floors${q}`).expect(200)).body[0].id;
    const cats = (await get(`/menu/categories${q}`).expect(200)).body;
    itemId = (
      await post(`/menu/items${q}`, {
        categoryId: cats[0].id,
        name: `Gift dish ${tag}`,
        price: 100,
        taxRatePercent: 0,
      }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('mixed tender: 60 card + 40 cash, refunding 25 to the card credits exactly 25', async () => {
    const c = await card(60);
    const id = await paidOrder(c.code, 60);
    expect(await balance(c.id)).toBe(0);
    await refund(id, 25).expect(201);
    expect(await balance(c.id)).toBe(25);
    expect(await refunded(id)).toBe(25);
  });

  it('refuses more than the card paid and changes nothing', async () => {
    const c = await card(60);
    const id = await paidOrder(c.code, 60);
    const res = await refund(id, 70);
    expect(res.status).toBe(400);
    expect(await balance(c.id)).toBe(0);
    expect(await refunded(id)).toBe(0);
    // The remaining 40 goes back through cash.
    await refund(id, 40, 'CASH').expect(201);
    expect(await balance(c.id)).toBe(0);
  });

  it('refuses a gift-card refund on an order paid without a card', async () => {
    const id = await paidOrder(null, 0);
    const res = await refund(id, 10);
    expect(res.status).toBe(400);
    expect(await refunded(id)).toBe(0);
  });

  it('repeated partial refunds credit exactly what was refunded, never beyond the card payment', async () => {
    const c = await card(33.33);
    const id = await paidOrder(c.code, 33.33);
    for (const a of [11.11, 11.11, 11.11]) await refund(id, a).expect(201);
    expect(Math.round((await balance(c.id)) * 100)).toBe(3333);
    expect((await refund(id, 0.01)).status).toBe(400);
    expect(Math.round((await balance(c.id)) * 100)).toBe(3333);
  });

  it('concurrent refunds cannot over-credit the card', async () => {
    const c = await card(60);
    const id = await paidOrder(c.code, 60);
    const rs = await Promise.all([
      refund(id, 40),
      refund(id, 40),
      refund(id, 40),
    ]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await balance(c.id)).toBe(40);
    expect(await refunded(id)).toBe(40);
  });

  it('a cash refund never touches the card', async () => {
    const c = await card(60);
    const id = await paidOrder(c.code, 60);
    await refund(id, 30, 'CASH').expect(201);
    expect(await balance(c.id)).toBe(0);
  });

  it('rolls the refund back if the card cannot be credited', async () => {
    const c = await card(60);
    const id = await paidOrder(c.code, 60);
    // The card row disappears out from under the refund (redemption cascades with it,
    // so re-add a redemption pointing at a card of another branch to force the failure).
    const demo = await prisma.branch.findUniqueOrThrow({
      where: { id: BRANCH },
    });
    const other = await prisma.branch.create({
      data: { restaurantId: demo.restaurantId, name: `Other ${tag}` },
    });
    const foreign = await prisma.giftCard.create({
      data: {
        branchId: other.id,
        code: `X${tag}${seq}`,
        initialValue: 10,
        balance: 10,
      },
    });
    await prisma.giftCardRedemption.updateMany({
      where: { orderId: id },
      data: { giftCardId: foreign.id },
    });
    const res = await refund(id, 10);
    expect(res.status).toBe(400);
    expect(await refunded(id)).toBe(0);
    expect(await balance(foreign.id)).toBe(10);
  });
});
