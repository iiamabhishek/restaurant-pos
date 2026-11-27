/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped by design */
// Expense approvals and the petty cash box, against a REAL Postgres: what a cashier submits waits and counts
// nowhere until an approver decides it; a decision happens once; the box balance is exact and never overdrawn;
// retries never post twice. Opt-in:
//   FINANCE_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand finance-approvals
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { BranchTimeService } from './../src/common/services/branch-time.service';
import { localDate } from './../src/common/time';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.FINANCE_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);
// The restaurant's own calendar day (reports and expenses use its time zone), not the UTC day: between 18:30 and
// midnight UTC the two differ for the seeded Asia/Kolkata restaurant.
let today = '';

run('Expense approvals and petty cash (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;

  const login = async (email: string) => {
    const a = request.agent(app.getHttpServer());
    await a
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);
    return a;
  };
  const expense = (who: typeof owner, extra: object = {}) =>
    who.post(`/api/v1/accounting/expenses${q}`).send({
      spentOn: today,
      category: `Cat-${tag}`,
      amount: 40,
      ...extra,
    });
  const box = async () =>
    (await owner.get(`/api/v1/accounting/petty-cash${q}`).expect(200)).body;
  const approvedTotal = async () =>
    Number(
      (
        await prisma.expense.aggregate({
          where: {
            branchId: BRANCH,
            category: `Cat-${tag}`,
            status: 'APPROVED',
          },
          _sum: { amount: true },
        })
      )._sum.amount ?? 0,
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
    today = localDate(
      new Date(),
      await app.get(BranchTimeService).tzForBranch(BRANCH),
    );
    owner = await login('owner@demo.local');
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const email = `fin-cashier-${tag}@demo.local`;
    await owner
      .post('/api/v1/users')
      .send({
        name: `Cashier ${tag}`,
        email,
        password: 'Password123!',
        roleId: roles.find((r) => r.name === 'CASHIER')!.id,
        branchIds: [BRANCH],
      })
      .expect(201);
    cashier = await login(email);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('expense approvals', () => {
    let pendingId: string;

    it('an approver’s expense is approved at once; a cashier’s waits', async () => {
      const own = await expense(owner).expect(201);
      expect(own.body.status).toBe('APPROVED');
      const mine = await expense(cashier, { amount: 25 }).expect(201);
      expect(mine.body.status).toBe('PENDING');
      pendingId = mine.body.id;
      expect(await approvedTotal()).toBe(40); // the pending 25 counts nowhere yet
    });

    it('a cashier cannot approve, reject, list pending or delete', async () => {
      await cashier
        .post(`/api/v1/accounting/expenses/${pendingId}/approve${q}`)
        .expect(403);
      await cashier
        .post(`/api/v1/accounting/expenses/${pendingId}/reject${q}`)
        .send({ note: 'no' })
        .expect(403);
      await cashier.get(`/api/v1/accounting/expenses/pending${q}`).expect(403);
      await cashier
        .delete(`/api/v1/accounting/expenses/${pendingId}${q}`)
        .expect(403);
    });

    it('the cashier sees their own submission and its status, the approver sees the queue', async () => {
      const mine = (
        await cashier.get(`/api/v1/accounting/expenses/mine${q}`).expect(200)
      ).body;
      expect((mine as { id: string }[]).map((e) => e.id)).toContain(pendingId);
      const queue = (
        await owner.get(`/api/v1/accounting/expenses/pending${q}`).expect(200)
      ).body;
      expect((queue as { id: string }[]).map((e) => e.id)).toContain(pendingId);
    });

    it('a rejection needs a reason; approval counts the expense and cannot be repeated', async () => {
      await owner
        .post(`/api/v1/accounting/expenses/${pendingId}/reject${q}`)
        .send({})
        .expect(400);
      await owner
        .post(`/api/v1/accounting/expenses/${pendingId}/approve${q}`)
        .send({ note: 'ok' })
        .expect(201);
      expect(await approvedTotal()).toBe(65);
      await owner
        .post(`/api/v1/accounting/expenses/${pendingId}/approve${q}`)
        .expect(409);
      await owner
        .post(`/api/v1/accounting/expenses/${pendingId}/reject${q}`)
        .send({ note: 'changed my mind' })
        .expect(409);
    });

    it('two approvers deciding at the same moment: exactly one wins', async () => {
      const id = (await expense(cashier, { amount: 10 }).expect(201)).body.id;
      const results = await Promise.all([
        owner.post(`/api/v1/accounting/expenses/${id}/approve${q}`),
        owner
          .post(`/api/v1/accounting/expenses/${id}/reject${q}`)
          .send({ note: 'dup' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('a rejected expense never counts, and a retried submit adds one expense', async () => {
      const before = await approvedTotal();
      const id = (await expense(cashier, { amount: 7 }).expect(201)).body.id;
      await owner
        .post(`/api/v1/accounting/expenses/${id}/reject${q}`)
        .send({ note: 'no receipt' })
        .expect(201);
      expect(await approvedTotal()).toBe(before);
      const key = `exp-${tag}-retry`;
      const [a, b] = await Promise.all([
        expense(cashier, { amount: 3, clientRequestId: key }),
        expense(cashier, { amount: 3, clientRequestId: key }),
      ]);
      expect([a.status, b.status].every((s) => s === 201)).toBe(true);
      expect(a.body.id).toBe(b.body.id);
      expect(
        await prisma.expense.count({ where: { clientRequestId: key } }),
      ).toBe(1);
    });

    it('pending expenses stay out of profit and loss until approved', async () => {
      const day = '2031-04-02';
      const spend = async () =>
        (
          await owner
            .get(`/api/v1/accounting/profit-loss${q}&from=${day}&to=${day}`)
            .expect(200)
        ).body.totalExpenses as number;
      const before = await spend();
      const id = (
        await expense(cashier, { spentOn: day, amount: 13 }).expect(201)
      ).body.id;
      expect(await spend()).toBe(before);
      await owner
        .post(`/api/v1/accounting/expenses/${id}/approve${q}`)
        .expect(201);
      expect(await spend()).toBe(before + 13);
    });

    it('pending expenses stay out of the cash closing', async () => {
      const day = '2031-03-09';
      const preview = async () =>
        (
          await owner
            .get(`/api/v1/accounting/closing/preview${q}&date=${day}`)
            .expect(200)
        ).body.cashExpenses;
      const before = await preview();
      const id = (
        await expense(cashier, {
          spentOn: day,
          amount: 11,
          paidFromCash: true,
        }).expect(201)
      ).body.id;
      expect(await preview()).toBe(before);
      await owner
        .post(`/api/v1/accounting/expenses/${id}/approve${q}`)
        .expect(201);
      expect(await preview()).toBe(before + 11);
    });
  });

  describe('petty cash box', () => {
    it('a cashier cannot touch the box', async () => {
      await cashier.get(`/api/v1/accounting/petty-cash${q}`).expect(403);
      await cashier
        .post(`/api/v1/accounting/petty-cash/topups${q}`)
        .send({ amount: 10 })
        .expect(403);
    });

    it('top-up, voucher and count keep an exact balance (no float drift)', async () => {
      const start = Number((await box()).balance);
      await owner
        .post(`/api/v1/accounting/petty-cash/topups${q}`)
        .send({ amount: 0.1 })
        .expect(201);
      await owner
        .post(`/api/v1/accounting/petty-cash/topups${q}`)
        .send({ amount: 0.2 })
        .expect(201);
      expect((await box()).balance).toBe((start + 0.3).toFixed(2));
    });

    it('a voucher pays out of the box and records its expense; it cannot overdraw', async () => {
      await owner
        .post(`/api/v1/accounting/petty-cash/topups${q}`)
        .send({ amount: 5 })
        .expect(201);
      const b0 = Number((await box()).balance);
      const v = await owner
        .post(`/api/v1/accounting/petty-cash/vouchers${q}`)
        .send({
          amount: 0.5,
          category: `Cat-${tag}`,
          payee: 'Milk man',
          receiptRef: 'R-1',
        })
        .expect(201);
      expect(v.body.kind).toBe('VOUCHER');
      expect(Number((await box()).balance)).toBeCloseTo(b0 - 0.5, 2);
      const exp = await prisma.expense.findUniqueOrThrow({
        where: { id: v.body.expenseId },
      });
      expect(exp.paidFromCash).toBe(false);
      expect(exp.status).toBe('APPROVED');
      await owner
        .post(`/api/v1/accounting/petty-cash/vouchers${q}`)
        .send({ amount: 999999, category: 'x' })
        .expect(409);
    });

    it('parallel vouchers cannot overdraw the box', async () => {
      await owner
        .post(`/api/v1/accounting/petty-cash/topups${q}`)
        .send({ amount: 100 })
        .expect(201);
      const target = Number((await box()).balance);
      const each = Math.floor((target / 2) * 100 + 1) / 100; // two of these exceed the box
      const rs = await Promise.all(
        [1, 2].map(() =>
          owner
            .post(`/api/v1/accounting/petty-cash/vouchers${q}`)
            .send({ amount: each, category: `Cat-${tag}` }),
        ),
      );
      expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(Number((await box()).balance)).toBeGreaterThanOrEqual(0);
    });

    it('a retried voucher posts once', async () => {
      await owner
        .post(`/api/v1/accounting/petty-cash/topups${q}`)
        .send({ amount: 50 })
        .expect(201);
      const key = `pcv-${tag}-retry`;
      const before = Number((await box()).balance);
      const rs = await Promise.all(
        [1, 2, 3].map(() =>
          owner
            .post(`/api/v1/accounting/petty-cash/vouchers${q}`)
            .send({ amount: 5, category: `Cat-${tag}`, clientRequestId: key }),
        ),
      );
      expect(rs.every((r) => r.status === 201)).toBe(true);
      expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
      expect(Number((await box()).balance)).toBeCloseTo(before - 5, 2);
      expect(
        await prisma.pettyCashEntry.count({ where: { clientRequestId: key } }),
      ).toBe(1);
    });

    it('a count that disagrees posts the difference so the book matches the cash', async () => {
      const book = Number((await box()).balance);
      const r = await owner
        .post(`/api/v1/accounting/petty-cash/counts${q}`)
        .send({ countedCash: book - 1.25, note: 'short' })
        .expect(201);
      expect(Number(r.body.delta)).toBeCloseTo(-1.25, 2);
      expect(Number(r.body.bookBalance)).toBeCloseTo(book, 2);
      expect(Number((await box()).balance)).toBeCloseTo(book - 1.25, 2);
    });

    it('a rejected voucher returns its money to the box', async () => {
      await owner
        .post(`/api/v1/accounting/petty-cash/topups${q}`)
        .send({ amount: 30 })
        .expect(201);
      // a keeper without approval rights: give the cashier the box but not approval
      const before = Number((await box()).balance);
      const v = await prisma.$transaction(async (tx) => {
        const e = await tx.expense.create({
          data: {
            branchId: BRANCH,
            createdById: (
              await tx.user.findFirstOrThrow({
                where: { email: 'owner@demo.local' },
              })
            ).id,
            spentOn: new Date(`${today}T00:00:00.000Z`),
            category: `Cat-${tag}`,
            amount: 12,
            status: 'PENDING',
          },
        });
        return tx.pettyCashEntry.create({
          data: {
            branchId: BRANCH,
            kind: 'VOUCHER',
            delta: -12,
            expenseId: e.id,
            createdById: e.createdById,
          },
        });
      });
      expect(Number((await box()).balance)).toBeCloseTo(before - 12, 2);
      await owner
        .post(`/api/v1/accounting/expenses/${v.expenseId}/reject${q}`)
        .send({ note: 'not allowed' })
        .expect(201);
      expect(Number((await box()).balance)).toBeCloseTo(before, 2);
    });

    it('rejects amounts with more than two decimals', async () => {
      await owner
        .post(`/api/v1/accounting/petty-cash/topups${q}`)
        .send({ amount: 1.005 })
        .expect(400);
    });
  });
});
