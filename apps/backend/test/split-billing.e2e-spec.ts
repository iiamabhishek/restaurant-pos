/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Split billing against a REAL Postgres: one open bill becomes several, each guest pays their own with their own
// method; the parts always add up to the original; a retry never splits twice. Opt-in:
//   SPLIT_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand split-billing
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const run = process.env.SPLIT_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);

run('Split billing (e2e)', () => {
  let app: INestApplication<App>;
  let agent: ReturnType<typeof request.agent>;
  let floorId: string;
  let itemA: string; // 100.00
  let itemB: string; // 33.33 (does not divide evenly by 3)
  let seq = 0;
  const post = (p: string, b?: object) => agent.post(`/api/v1${p}`).send(b);
  const get = (p: string) => agent.get(`/api/v1${p}`);
  const order = async (items: { id: string; qty: number }[]) => {
    const t = await post(`/tables${q}`, {
      floorId,
      number: `S${++seq}-${tag}`,
      capacity: 6,
    }).expect(201);
    const o = await post(`/orders${q}`, {
      type: 'DINE_IN',
      tableId: t.body.id,
      items: items.map((i) => ({
        menuItemId: i.id,
        quantity: i.qty,
        modifierIds: [],
      })),
    }).expect(201);
    return o.body as {
      id: string;
      totalAmount: string;
      items: { id: string; menuItemId: string; quantity: number }[];
    };
  };
  const split = (id: string, lines: object[], requestId = randomUUID()) =>
    post(`/orders/${id}/split${q}`, { lines, requestId });
  const bill = async (id: string) =>
    (await get(`/orders/${id}${q}`).expect(200)).body;
  const cents = (v: string) => Math.round(Number(v) * 100);

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
    agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    floorId = (await get(`/tables/floors${q}`).expect(200)).body[0].id;
    const cats = (await get(`/menu/categories${q}`).expect(200)).body;
    const mk = async (name: string, price: number) =>
      (
        await post(`/menu/items${q}`, {
          categoryId: cats[0].id,
          name: `${name} ${tag}`,
          price,
          taxRatePercent: 0,
        }).expect(201)
      ).body.id;
    itemA = await mk('Pizza', 100);
    itemB = await mk('Odd', 33.33);
  });

  afterAll(async () => {
    await app.close();
  });

  it('moves whole lines to a new bill and both totals are right', async () => {
    const o = await order([
      { id: itemA, qty: 1 },
      { id: itemB, qty: 1 },
    ]);
    const lineB = o.items.find((i) => i.menuItemId === itemB)!;
    const r = await split(o.id, [
      { orderItemId: lineB.id, quantity: 1 },
    ]).expect(201);
    expect(r.body.id).not.toBe(o.id);
    expect(Number(r.body.totalAmount)).toBe(33.33);
    expect(Number((await bill(o.id)).totalAmount)).toBe(100);
    expect(r.body.notes).toMatch(/Split from/);
  });

  it('splits a quantity: 3 of a 33.33 item three ways, and the parts add up to the original', async () => {
    const o = await order([{ id: itemB, qty: 3 }]);
    const line = o.items[0];
    const before = cents(o.totalAmount); // 9999
    const g2 = await split(o.id, [
      { orderItemId: line.id, quantity: 1 },
    ]).expect(201);
    const g3 = await split(o.id, [
      { orderItemId: line.id, quantity: 1 },
    ]).expect(201);
    const parts = [
      cents((await bill(o.id)).totalAmount),
      cents(g2.body.totalAmount),
      cents(g3.body.totalAmount),
    ];
    expect(parts.reduce((a, b) => a + b, 0)).toBe(before);
    const remaining = (await bill(o.id)).items as {
      id: string;
      quantity: number;
    }[];
    expect(remaining.find((i) => i.id === line.id)?.quantity).toBe(1);
  });

  it('each guest pays their own bill with their own method', async () => {
    const o = await order([{ id: itemA, qty: 2 }]);
    const g2 = await split(o.id, [
      { orderItemId: o.items[0].id, quantity: 1 },
    ]).expect(201);
    await post(`/orders/${o.id}/checkout${q}`, {
      requestId: randomUUID(),
      payments: [{ method: 'CASH', amount: 100 }],
    }).expect(201);
    await post(`/orders/${g2.body.id}/checkout${q}`, {
      requestId: randomUUID(),
      payments: [{ method: 'UPI', amount: 100 }],
    }).expect(201);
    expect((await bill(o.id)).status).toBe('PAID');
    const second = await bill(g2.body.id);
    expect(second.status).toBe('PAID');
    expect(second.payments[0].method).toBe('UPI');
  });

  it('a retry with the same request id returns the same new bill and does not split again', async () => {
    const o = await order([{ id: itemA, qty: 4 }]);
    const key = randomUUID();
    const rs = await Promise.all(
      [1, 2, 3].map(() =>
        split(o.id, [{ orderItemId: o.items[0].id, quantity: 1 }], key),
      ),
    );
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect((await bill(o.id)).items[0].quantity).toBe(3); // moved once, not three times
  });

  it('refuses: everything moved, too many, a foreign line, a paid bill', async () => {
    const o = await order([{ id: itemA, qty: 2 }]);
    const l = o.items[0].id;
    await split(o.id, [{ orderItemId: l, quantity: 2 }]).expect(400); // nothing would stay
    await split(o.id, [{ orderItemId: l, quantity: 3 }]).expect(400);
    const other = await order([{ id: itemA, qty: 1 }]);
    await split(o.id, [{ orderItemId: other.items[0].id, quantity: 1 }]).expect(
      400,
    );
    // the same line twice in one request cannot exceed its quantity
    await split(o.id, [
      { orderItemId: l, quantity: 1 },
      { orderItemId: l, quantity: 1 },
    ]).expect(400);
    await post(`/orders/${o.id}/checkout${q}`, {
      requestId: randomUUID(),
      payments: [{ method: 'CASH', amount: 200 }],
    }).expect(201);
    await split(o.id, [{ orderItemId: l, quantity: 1 }]).expect(400);
  });

  it('a bill with a payment on it cannot be split', async () => {
    const o = await order([{ id: itemA, qty: 2 }]);
    await post(`/orders/${o.id}/checkout${q}`, {
      allowPartial: true,
      requestId: randomUUID(),
      payments: [{ method: 'CASH', amount: 50 }],
    }).expect(201);
    await split(o.id, [{ orderItemId: o.items[0].id, quantity: 1 }]).expect(
      409,
    );
  });
});
