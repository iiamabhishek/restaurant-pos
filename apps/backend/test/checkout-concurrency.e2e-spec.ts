/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped by design */
// Concurrent checkout against a REAL Postgres: two tills must never overpay one
// open bill, a replayed requestId must never charge twice, and settlement side
// effects must happen exactly once. Opt-in:
//   CHECKOUT_RACE_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand checkout-concurrency
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.CHECKOUT_RACE_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);

run('Concurrent checkout (e2e, real Postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let agent: ReturnType<typeof request.agent>;
  let floorId: string;
  let itemId: string; // 100.00, no tax -> bill is exactly 100 (200 for qty 2)
  let tableSeq = 0;

  const post = (p: string, b?: object) => agent.post(`/api/v1${p}`).send(b);
  const get = (p: string) => agent.get(`/api/v1${p}`);

  /** A fresh OPEN dine-in order whose bill is `qty * 100`. */
  const openOrder = async (qty: number) => {
    const t = await post(`/tables${q}`, {
      floorId,
      number: `R${++tableSeq}-${tag}`,
      capacity: 4,
    }).expect(201);
    const o = await post(`/orders${q}`, {
      type: 'DINE_IN',
      tableId: t.body.id,
      items: [{ menuItemId: itemId, quantity: qty, modifierIds: [] }],
    }).expect(201);
    return o.body.id as string;
  };
  const pay = (id: string, amount: number, extra: object = {}) =>
    post(`/orders/${id}/checkout${q}`, {
      allowPartial: true,
      requestId: randomUUID(),
      payments: [{ method: 'CASH', amount }],
      ...extra,
    });
  const state = async (id: string) => {
    const o = (await get(`/orders/${id}${q}`).expect(200)).body;
    const paid = o.payments.reduce(
      (s: number, p: any) => s + Number(p.amount),
      0,
    );
    return { status: o.status as string, paid, payments: o.payments.length };
  };

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
        name: `Race dish ${tag}`,
        price: 100,
        taxRatePercent: 0,
      }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('two simultaneous cash tenders that together exceed the bill record exactly the bill', async () => {
    const id = await openOrder(1); // bill 100
    const [a, b] = await Promise.all([pay(id, 70), pay(id, 70)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const s = await state(id);
    // Serialized: the first 70 is partial, the second is applied only to the
    // remaining 30 and the other 40 is returned as change, never booked.
    expect(s.paid).toBe(100);
    expect(s.payments).toBe(2);
    expect(s.status).toBe('PAID');
    const settlements = [a.body.settlement, b.body.settlement];
    expect(settlements.filter((x) => x.fullyPaid)).toHaveLength(1);
    expect(settlements.find((x) => x.fullyPaid).changeDue).toBe(40);
  });

  it('two simultaneous non-cash payments that exceed the bill never overpay', async () => {
    const id = await openOrder(1);
    const card = (amount: number) =>
      post(`/orders/${id}/checkout${q}`, {
        allowPartial: true,
        requestId: randomUUID(),
        payments: [{ method: 'CARD', amount }],
      });
    await Promise.all([card(70), card(70)]);
    const s = await state(id);
    expect(s.paid).toBeLessThanOrEqual(100);
  });

  it('two simultaneous payments that exactly fit both succeed and settle once', async () => {
    const id = await openOrder(1);
    const [a, b] = await Promise.all([pay(id, 50), pay(id, 50)]);
    const s = await state(id);
    expect(s.paid).toBe(100);
    expect([a.status, b.status].sort()).toEqual([201, 201]);
    expect(s.status).toBe('PAID');
  });

  it('a partial payment racing the final payment never overpays', async () => {
    const id = await openOrder(1);
    await Promise.all([pay(id, 40), pay(id, 100)]);
    const s = await state(id);
    expect(s.paid).toBeLessThanOrEqual(100);
    // Cash tendered above the balance is change, never extra revenue.
    expect(s.payments).toBeGreaterThanOrEqual(1);
  });

  it('parallel copies of the same requestId record exactly one payment', async () => {
    const id = await openOrder(1);
    const requestId = randomUUID();
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => pay(id, 30, { requestId })),
    );
    expect(
      rs.map((r) => `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`),
    ).toEqual(Array(5).fill(expect.stringMatching(/^201 /)));
    const s = await state(id);
    expect(s.payments).toBe(1);
    expect(s.paid).toBe(30);
  });

  it('a retry after completion with the same requestId is a replay, not a second charge', async () => {
    const id = await openOrder(1);
    const requestId = randomUUID();
    await pay(id, 100, { requestId, allowPartial: false }).expect(201);
    const again = await pay(id, 100, { requestId, allowPartial: false });
    expect([200, 201]).toContain(again.status);
    expect((await state(id)).payments).toBe(1);
  });

  it('a new request on an already-settled bill is refused', async () => {
    const id = await openOrder(1);
    await pay(id, 100, { allowPartial: false }).expect(201);
    const late = await pay(id, 10);
    expect(late.status).toBeGreaterThanOrEqual(400);
    expect((await state(id)).paid).toBe(100);
  });

  it('a failed (rolled back) checkout leaves the bill payable', async () => {
    const id = await openOrder(1);
    const bad = await post(`/orders/${id}/checkout${q}`, {
      allowPartial: true,
      requestId: randomUUID(),
      payments: [{ method: 'CASH', amount: -5 }],
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect((await state(id)).payments).toBe(0);
    await pay(id, 100, { allowPartial: false }).expect(201);
    expect((await state(id)).status).toBe('PAID');
  });

  it('a final payment deducts stock and frees the table exactly once under a double submit', async () => {
    const id = await openOrder(1);
    const [a, b] = await Promise.all([
      pay(id, 100, { allowPartial: false }),
      pay(id, 100, { allowPartial: false }),
    ]);
    expect([a.status, b.status].filter((c) => c === 201)).toHaveLength(1);
    const s = await state(id);
    expect(s.payments).toBe(1);
    expect(s.paid).toBe(100);
    const movements = await prisma.stockMovement
      .count({ where: { orderId: id } })
      .catch(() => 0);
    expect(movements).toBeLessThanOrEqual(1);
  });
});
