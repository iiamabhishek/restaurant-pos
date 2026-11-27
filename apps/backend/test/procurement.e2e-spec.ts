/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped by design */
// Purchase returns (stock out + supplier credit), price variance and the reorder list, against a REAL Postgres.
//   PROCUREMENT_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand procurement
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

const run = process.env.PROCUREMENT_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);
// The restaurant's own calendar day (reports and expenses use its time zone), not the UTC day: between 18:30 and
// midnight UTC the two differ for the seeded Asia/Kolkata restaurant.
let today = '';
const P = '/api/v1/inventory/procurement';

run('Procurement: returns, variance, reorder (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  let supplierId: string;
  let ingredientId: string;
  let grnId: string;
  let grnItemId: string;
  let invoiceId: string;

  const stock = async () =>
    Number(
      (
        await prisma.ingredient.findUniqueOrThrow({
          where: { id: ingredientId },
        })
      ).currentStock,
    );
  const invoice = () =>
    prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const ret = (qty: number, extra: object = {}) =>
    owner.post(`${P}/returns${q}`).send({
      goodsReceiptId: grnId,
      reason: 'Spoiled on arrival',
      items: [{ goodsReceiptItemId: grnItemId, quantity: qty }],
      ...extra,
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
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();
    prisma = app.get(PrismaService);
    today = localDate(
      new Date(),
      await app.get(BranchTimeService).tzForBranch(BRANCH),
    );
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const email = `proc-cashier-${tag}@demo.local`;
    await owner
      .post('/api/v1/users')
      .send({
        name: `C ${tag}`,
        email,
        password: 'Password123!',
        roleId: roles.find((r) => r.name === 'CASHIER')!.id,
        branchIds: [BRANCH],
      })
      .expect(201);
    cashier = request.agent(app.getHttpServer());
    await cashier
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);

    supplierId = (
      await owner
        .post(`/api/v1/inventory/suppliers${q}`)
        .send({ name: `Sup ${tag}` })
        .expect(201)
    ).body.id;
    ingredientId = (
      await owner
        .post(`/api/v1/inventory/ingredients${q}`)
        .send({ name: `Rice ${tag}`, unit: 'KG', reorderLevel: 20 })
        .expect(201)
    ).body.id;
    // Receipt 1: 100 kg at 50. (Price baseline for "last price".)
    await owner
      .post(`/api/v1/inventory/goods-receipts${q}`)
      .send({
        supplierId,
        items: [{ ingredientId, quantity: 100, unitCost: 50 }],
      })
      .expect(201);
    // Receipt 2: 40 kg at 60, the one we will return against.
    const g = (
      await owner
        .post(`/api/v1/inventory/goods-receipts${q}`)
        .send({
          supplierId,
          items: [{ ingredientId, quantity: 40, unitCost: 60 }],
        })
        .expect(201)
    ).body;
    grnId = g.id;
    grnItemId = (
      await prisma.goodsReceiptItem.findFirstOrThrow({
        where: { goodsReceiptId: grnId },
      })
    ).id;
    invoiceId = (
      await owner
        .post(`/api/v1/inventory/supplier-invoices${q}`)
        .send({
          supplierId,
          goodsReceiptId: grnId,
          invoiceNumber: `INV-${tag}`,
          invoiceDate: today,
          totalAmount: 2520,
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a cashier cannot return goods or read variance', async () => {
    await cashier.post(`${P}/returns${q}`).send({}).expect(403);
    await cashier
      .get(`${P}/price-variance${q}&from=${today}&to=${today}`)
      .expect(403);
  });

  it('a return takes stock out and credits the invoice at the price paid', async () => {
    const before = await stock(); // 140
    const r = await ret(10).expect(201);
    expect(r.body.returnNumber).toMatch(/^PR-\d{4}$/);
    expect(Number(r.body.totalAmount)).toBe(600); // 10 x 60, the price on that receipt
    expect(Number(r.body.creditApplied)).toBe(600);
    expect(Number(r.body.creditOpen)).toBe(0);
    expect(await stock()).toBe(before - 10);
    const inv = await invoice();
    expect(Number(inv.creditedAmount)).toBe(600);
    expect(inv.status).toBe('PARTIALLY_PAID'); // credit settles part of 2520
    const mv = await prisma.stockMovement.findFirst({
      where: { ingredientId, type: 'PURCHASE_RETURN' },
    });
    expect(Number(mv?.quantity)).toBe(-10);
  });

  it('credit counts in what is still payable', async () => {
    // 2520 - 600 credit = 1920 left; paying 1921 must fail, 1920 settles it.
    await owner
      .post(`/api/v1/inventory/supplier-invoices/${invoiceId}/payments${q}`)
      .send({ amount: 1921, paymentMethod: 'CASH' })
      .expect(400);
    const bal = (
      await owner.get(`${P}/suppliers/${supplierId}/balance${q}`).expect(200)
    ).body;
    expect(bal.owed).toBe('1920.00');
  });

  it('cannot return more than was received minus what already went back', async () => {
    const res = await ret(31).expect(400); // 40 received, 10 already returned
    expect(res.body.message).toMatch(/Only 30/);
    await ret(30).expect(201); // exactly the rest is fine
    await ret(1).expect(400);
  });

  it('the same line twice in one request cannot dodge the cap', async () => {
    await owner
      .post(`${P}/returns${q}`)
      .send({
        goodsReceiptId: grnId,
        reason: 'x',
        items: [
          { goodsReceiptItemId: grnItemId, quantity: 0.001 },
          { goodsReceiptItemId: grnItemId, quantity: 0.001 },
        ],
      })
      .expect(400);
  });

  it('a credit bigger than the invoice leaves an open credit on the supplier and the balance goes negative', async () => {
    const bal = (
      await owner.get(`${P}/suppliers/${supplierId}/balance${q}`).expect(200)
    ).body;
    // returned 40 x 60 = 2400 against 2520 invoice -> 120 still owed, nothing open
    expect(bal.owed).toBe('120.00');
    expect(bal.openCredit).toBe('0.00');
  });

  it('parallel returns of the same receipt cannot over-return', async () => {
    const g = (
      await owner
        .post(`/api/v1/inventory/goods-receipts${q}`)
        .send({
          supplierId,
          items: [{ ingredientId, quantity: 10, unitCost: 70 }],
        })
        .expect(201)
    ).body;
    const itemId = (
      await prisma.goodsReceiptItem.findFirstOrThrow({
        where: { goodsReceiptId: g.id },
      })
    ).id;
    const send = () =>
      owner.post(`${P}/returns${q}`).send({
        goodsReceiptId: g.id,
        reason: 'race',
        items: [{ goodsReceiptItemId: itemId, quantity: 6 }],
      });
    const rs = await Promise.all([send(), send()]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
    const sum = await prisma.purchaseReturnItem.aggregate({
      where: { goodsReceiptItemId: itemId },
      _sum: { quantity: true },
    });
    expect(Number(sum._sum.quantity)).toBe(6);
  });

  it('a retried return with the same key takes stock out once', async () => {
    const g = (
      await owner
        .post(`/api/v1/inventory/goods-receipts${q}`)
        .send({
          supplierId,
          items: [{ ingredientId, quantity: 5, unitCost: 55 }],
        })
        .expect(201)
    ).body;
    const itemId = (
      await prisma.goodsReceiptItem.findFirstOrThrow({
        where: { goodsReceiptId: g.id },
      })
    ).id;
    const key = `ret-${tag}-retry`;
    const before = await stock();
    const send = () =>
      owner.post(`${P}/returns${q}`).send({
        goodsReceiptId: g.id,
        reason: 'retry',
        clientRequestId: key,
        items: [{ goodsReceiptItemId: itemId, quantity: 2 }],
      });
    const rs = await Promise.all([send(), send(), send()]);
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect(await stock()).toBe(before - 2);
  });

  it('a return fails whole when the stock is no longer there', async () => {
    const g = (
      await owner
        .post(`/api/v1/inventory/goods-receipts${q}`)
        .send({
          supplierId,
          items: [{ ingredientId, quantity: 3, unitCost: 55 }],
        })
        .expect(201)
    ).body;
    const itemId = (
      await prisma.goodsReceiptItem.findFirstOrThrow({
        where: { goodsReceiptId: g.id },
      })
    ).id;
    // use up nearly everything so 3 kg cannot go back
    const have = await stock();
    await owner
      .post(`/api/v1/inventory/ingredients/${ingredientId}/adjust${q}`)
      .send({ quantity: -(have - 1), note: 'drain' })
      .expect(201);
    const returnsBefore = await prisma.purchaseReturn.count({
      where: { branchId: BRANCH },
    });
    await owner
      .post(`${P}/returns${q}`)
      .send({
        goodsReceiptId: g.id,
        reason: 'x',
        items: [{ goodsReceiptItemId: itemId, quantity: 3 }],
      })
      .expect(400);
    expect(
      await prisma.purchaseReturn.count({ where: { branchId: BRANCH } }),
    ).toBe(returnsBefore);
    expect(await stock()).toBe(1);
  });

  it('price variance flags the rise from 50 to 60 and the invoice difference', async () => {
    const v = (
      await owner
        .get(
          `${P}/price-variance${q}&from=${today}&to=${today}&supplierId=${supplierId}&threshold=5`,
        )
        .expect(200)
    ).body;
    const line = (
      v.lines as {
        receivedUnitCost: string;
        lastUnitCost: string | null;
        lastVariancePct: number;
        flagged: boolean;
      }[]
    ).find((l) => l.receivedUnitCost === '60');
    expect(line?.lastUnitCost).toBe('50');
    expect(line?.lastVariancePct).toBe(20);
    expect(line?.flagged).toBe(true);
    const chk = (
      v.invoiceChecks as {
        invoiceNumber: string;
        receiptTotal: string;
        invoiceTotal: string;
        difference: string;
        flagged: boolean;
      }[]
    ).find((c) => c.invoiceNumber === `INV-${tag}`);
    expect(chk?.receiptTotal).toBe('2400.00');
    expect(chk?.invoiceTotal).toBe('2520.00');
    expect(chk?.difference).toBe('120.00');
    expect(chk?.flagged).toBe(true);
    await owner
      .get(`${P}/price-variance${q}&from=${today}&to=${today}&threshold=abc`)
      .expect(400);
  });

  it('the reorder list counts stock on order, shows the supplier and last price', async () => {
    const list = async () =>
      (
        (await owner.get(`/api/v1/inventory/journal/reorder${q}`).expect(200))
          .body as {
          id: string;
          toBuy: string;
          onOrder: string;
          supplier: { name: string } | null;
          lastUnitCost: string | null;
        }[]
      ).find((r) => r.id === ingredientId);
    const row = await list();
    expect(row).toBeDefined(); // 1 kg left, minimum 20
    expect(Number(row!.toBuy)).toBe(39); // par = 2 x 20 = 40, in stock 1
    expect(row!.supplier?.name).toBe(`Sup ${tag}`);
    expect(Number(row!.lastUnitCost)).toBe(55);
    const po = (
      await owner
        .post(`/api/v1/inventory/purchase-orders${q}`)
        .send({
          supplierId,
          items: [{ ingredientId, quantityOrdered: 25, unitCost: 55 }],
        })
        .expect(201)
    ).body;
    await owner
      .patch(`/api/v1/inventory/purchase-orders/${po.id}/status${q}`)
      .send({ status: 'SENT' })
      .expect(200);
    const after = await list();
    expect(after!.onOrder).toBe('25');
    expect(Number(after!.toBuy)).toBe(14); // 39 - 25 already coming
  });
});
