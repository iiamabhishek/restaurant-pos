/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped by design */
// The accounting journal export against a REAL Postgres: every voucher balances to the cent, pending expenses stay
// out, and only people with accounting and export rights can download it. Opt-in:
//   JOURNAL_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand journal-export
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const run = process.env.JOURNAL_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

const parse = (csv: string) =>
  csv
    .replace(new RegExp('^' + String.fromCharCode(0xfeff)), '')
    .trim()
    .split(/\r\n/)
    .slice(1)
    .map((l) =>
      l
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map((c) => c.replace(/^"|"$/g, '')),
    );

run('Accounting journal export (e2e)', () => {
  let app: INestApplication<App>;
  let owner: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  let accountant: ReturnType<typeof request.agent>;
  const from = ymd(new Date(Date.now() - 365 * 86_400_000));
  const to = ymd(new Date(Date.now() + 86_400_000));
  const url = `/api/v1/accounting/export/journal${q}&from=${from}&to=${to}`;

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
    owner = await login('owner@demo.local');
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const mk = async (role: string) => {
      const email = `jr-${role.toLowerCase()}-${tag}@demo.local`;
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
    cashier = await mk('CASHIER');
    accountant = await mk('ACCOUNTANT');
    // A supplier invoice, an approved expense and a pending one.
    const sup = (
      await owner
        .post(`/api/v1/inventory/suppliers${q}`)
        .send({ name: `Jr ${tag}` })
        .expect(201)
    ).body.id;
    await owner
      .post(`/api/v1/inventory/supplier-invoices${q}`)
      .send({
        supplierId: sup,
        invoiceNumber: `JR-${tag}`,
        invoiceDate: ymd(new Date()),
        totalAmount: 1234.56,
      })
      .expect(201);
    await owner
      .post(`/api/v1/accounting/expenses${q}`)
      .send({ spentOn: ymd(new Date()), category: `Appr ${tag}`, amount: 77.7 })
      .expect(201);
    await cashier
      .post(`/api/v1/accounting/expenses${q}`)
      .send({ spentOn: ymd(new Date()), category: `Pend ${tag}`, amount: 11.1 })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('every voucher balances to the cent', async () => {
    const res = await owner.get(url).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const rows = parse(res.text);
    expect(rows.length).toBeGreaterThan(0);
    const sums = new Map<string, number>();
    for (const r of rows) {
      const key = `${r[1]}|${r[2]}`;
      sums.set(
        key,
        (sums.get(key) ?? 0) +
          Math.round(Number(r[4] || 0) * 100) -
          Math.round(Number(r[5] || 0) * 100),
      );
    }
    const bad = [...sums].filter(([, v]) => v !== 0);
    expect(bad).toEqual([]);
  });

  it('includes the purchase and the approved expense, not the pending one', async () => {
    const rows = parse((await owner.get(url).expect(200)).text);
    expect(
      rows.some(
        (r) =>
          r[1] === 'Purchase' &&
          r[2] === `JR-${tag}` &&
          r[3] === 'Purchases' &&
          r[4] === '1234.56',
      ),
    ).toBe(true);
    expect(
      rows.some((r) => r[3] === `Expense: Appr ${tag}` && r[4] === '77.70'),
    ).toBe(true);
    expect(rows.some((r) => r[3] === `Expense: Pend ${tag}`)).toBe(false);
  });

  it('Excel works, a bad format is refused, and a cashier cannot download it', async () => {
    const x = await owner
      .get(`${url}&format=xlsx`)
      .buffer(true)
      .parse((r, cb) => {
        const c: Buffer[] = [];
        r.on('data', (d: Buffer) => c.push(d));
        r.on('end', () => cb(null, Buffer.concat(c)));
      })
      .expect(200);
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    await owner.get(`${url}&format=pdf`).expect(400);
    await cashier.get(url).expect(403);
  });

  it('an accountant (accounting + export rights) can download it', async () => {
    await accountant.get(url).expect(200);
  });
});
