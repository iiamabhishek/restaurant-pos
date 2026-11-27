/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped by design */
// Old invoices stay reachable: the day book and daily sales accept long ranges, a report viewer without order
// rights can open a bill read-only, and no one can open another branch's bill. Opt-in:
//   REPORTS_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand reports-bills
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.REPORTS_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

run('Reports: old invoices and bill view (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let accountant: ReturnType<typeof request.agent>;
  let waiter: ReturnType<typeof request.agent>;
  let oldBillId: string;

  const login = async (email: string) => {
    const a = request.agent(app.getHttpServer());
    await a
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);
    return a;
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
    owner = await login('owner@demo.local');
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const mk = async (role: string) => {
      const email = `rep-${role.toLowerCase()}-${tag}@demo.local`;
      await owner
        .post('/api/v1/users')
        .send({
          name: `${role} ${tag}`,
          email,
          password: 'Password123!',
          roleId: roles.find((r) => r.name === role)!.id,
          branchIds: [BRANCH],
        })
        .expect(201);
      return login(email);
    };
    accountant = await mk('ACCOUNTANT');
    waiter = await mk('WAITER');
    const ownerId = (
      await prisma.user.findFirstOrThrow({
        where: { email: 'owner@demo.local' },
      })
    ).id;
    // A paid bill from about three years ago.
    const billedAt = daysAgo(1100);
    const o = await prisma.order.create({
      data: {
        branchId: BRANCH,
        orderNumber: `OLD-${tag}`,
        type: 'TAKEAWAY',
        status: 'PAID',
        createdById: ownerId,
        subtotal: 120,
        totalAmount: 120,
        billedAt,
        createdAt: billedAt,
        items: {
          create: [
            {
              menuItemId: (
                await prisma.menuItem.findFirstOrThrow({
                  where: { branchId: BRANCH },
                })
              ).id,
              nameSnapshot: 'Old tea',
              unitPriceSnapshot: 60,
              taxRateSnapshot: 0,
              quantity: 2,
              lineTotal: 120,
            },
          ],
        },
        payments: { create: [{ method: 'CASH', amount: 120 }] },
      },
    });
    oldBillId = o.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a range longer than a year works and finds the old bill', async () => {
    const from = ymd(daysAgo(1200));
    const to = ymd(new Date());
    const r = await owner
      .get(`/api/v1/reports/invoices${q}&from=${from}&to=${to}`)
      .expect(200);
    expect(r.body.rowOrderIds).toContain(oldBillId);
    await owner
      .get(`/api/v1/reports/sales-daily${q}&from=${from}&to=${to}`)
      .expect(200);
  });

  it('more than five years is refused with a clear message', async () => {
    const res = await owner
      .get(
        `/api/v1/reports/invoices${q}&from=${ymd(daysAgo(2000))}&to=${ymd(new Date())}`,
      )
      .expect(400);
    expect(res.body.message).toMatch(/five years/);
  });

  it('an accountant (reports only, no order rights) opens the old bill read-only', async () => {
    const b = await accountant
      .get(`/api/v1/reports/bills/${oldBillId}${q}`)
      .expect(200);
    expect(b.body.orderNumber).toBe(`OLD-${tag}`);
    expect(b.body.payments[0].method).toBe('CASH');
    await accountant.get(`/api/v1/orders/${oldBillId}${q}`).expect(403); // the order window stays closed to them
  });

  it('someone without reports access cannot open it', async () => {
    await waiter.get(`/api/v1/reports/bills/${oldBillId}${q}`).expect(403);
  });

  it('a bill id from another branch is not found', async () => {
    await owner
      .get(`/api/v1/reports/bills/${oldBillId}?branchId=${randomUUID()}`)
      .expect((r) => expect([403, 404]).toContain(r.status));
  });

  it('order history can be searched by date range and bill number', async () => {
    const from = ymd(daysAgo(1101));
    const to = ymd(daysAgo(1099));
    const r = await owner
      .get(
        `/api/v1/orders/manage${q}&tab=history&from=${from}&to=${to}&q=OLD-${tag}`,
      )
      .expect(200);
    expect((r.body as { id: string }[]).map((x) => x.id)).toContain(oldBillId);
  });
});
