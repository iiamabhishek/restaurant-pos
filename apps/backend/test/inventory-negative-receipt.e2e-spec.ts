/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped by design */
// Goods receipts against a REAL Postgres when stock is already negative: the
// cached balance must equal the movement ledger, and the weighted-average cost
// policy must hold. Also: a recipe-tracked dish cannot be left without a recipe.
//   INVENTORY_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand inventory-negative-receipt
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.INVENTORY_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);

run('Negative stock, receipts and recipe tracking (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let supplierId: string;
  let categoryId: string;
  let ownerId: string;

  const api = (p: string) => `/api/v1${p}${q}`;
  const ingredient = async (name: string, cost: number) => {
    const res = await owner
      .post(api('/inventory/ingredients'))
      .send({ name: `${name}-${tag}`, unit: 'PIECE', costPerUnit: cost })
      .expect(201);
    return res.body.id as string;
  };
  const row = (id: string) =>
    prisma.ingredient.findUniqueOrThrow({ where: { id } });
  const ledger = async (id: string) =>
    (
      await prisma.stockMovement.findMany({ where: { ingredientId: id } })
    ).reduce((s, m) => s + Number(m.quantity), 0);
  const receive = (ingredientId: string, quantity: number, unitCost: number) =>
    owner.post(api('/inventory/goods-receipts')).send({
      supplierId,
      items: [{ ingredientId, quantity, unitCost }],
    });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();
    prisma = app.get(PrismaService);
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    ownerId = (
      await prisma.user.findFirstOrThrow({
        where: { email: 'owner@demo.local' },
      })
    ).id;
    supplierId = (
      await owner
        .post(api('/inventory/suppliers'))
        .send({ name: `Supplier ${tag}` })
        .expect(201)
    ).body.id;
    categoryId = (await owner.get(api('/menu/categories')).expect(200)).body[0]
      .id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('receiving into positive stock uses the weighted average cost', async () => {
    const id = await ingredient('wavg', 10);
    await receive(id, 10, 10).expect(201); // 10 @ 10
    await receive(id, 10, 20).expect(201); // +10 @ 20 -> avg 15
    const r = await row(id);
    expect(Number(r.currentStock)).toBe(20);
    expect(Number(r.costPerUnit)).toBe(15);
    expect(Number(r.currentStock)).toBe(await ledger(id));
  });

  it('receiving into NEGATIVE stock keeps the cache equal to the ledger and prices the new balance at the receipt cost', async () => {
    const id = await ingredient('neg', 10);
    // A sale-driven shortage: 4 units went out that were never received.
    await prisma.$transaction(async (tx) => {
      await tx.ingredient.update({
        where: { id },
        data: { currentStock: -4, costPerUnit: 10 },
      });
      await tx.stockMovement.create({
        data: {
          branch: { connect: { id: BRANCH } },
          ingredient: { connect: { id } },
          createdBy: { connect: { id: ownerId } },
          type: 'CONSUMPTION',
          quantity: -4,
          note: 'e2e shortage',
        },
      });
    });
    await receive(id, 10, 30).expect(201);
    const r = await row(id);
    // -4 + 10 = 6: the balance is the true signed sum, not 10 (clamped base).
    expect(Number(r.currentStock)).toBe(6);
    expect(Number(r.currentStock)).toBe(await ledger(id));
    // The negative base is not averaged; the 6 units are priced at the receipt.
    expect(Number(r.costPerUnit)).toBe(30);
  });

  it('a receipt that leaves stock still negative keeps the previous cost', async () => {
    const id = await ingredient('stillneg', 12);
    await prisma.$transaction(async (tx) => {
      await tx.ingredient.update({
        where: { id },
        data: { currentStock: -10, costPerUnit: 12 },
      });
      await tx.stockMovement.create({
        data: {
          branch: { connect: { id: BRANCH } },
          ingredient: { connect: { id } },
          createdBy: { connect: { id: ownerId } },
          type: 'CONSUMPTION',
          quantity: -10,
          note: 'e2e shortage',
        },
      });
    });
    await receive(id, 3, 99).expect(201);
    const r = await row(id);
    expect(Number(r.currentStock)).toBe(-7);
    expect(Number(r.currentStock)).toBe(await ledger(id));
    expect(Number(r.costPerUnit)).toBe(12);
  });

  it('a recipe cannot be emptied while the dish is still tracked by recipe', async () => {
    const item = (
      await owner
        .post(api('/menu/items'))
        .send({
          categoryId,
          name: `Dish ${tag}`,
          price: 100,
          taxRatePercent: 0,
        })
        .expect(201)
    ).body.id as string;
    const ing = await ingredient('recipe', 5);
    await owner
      .patch(api(`/inventory/menu-items/${item}/recipe`))
      .send({ lines: [{ ingredientId: ing, quantity: 2 }] })
      .expect(200);
    const emptied = await owner
      .patch(api(`/inventory/menu-items/${item}/recipe`))
      .send({ lines: [] });
    expect(emptied.status).toBe(400);
    // The recipe is untouched by the refused request.
    const kept = await owner
      .get(api(`/inventory/menu-items/${item}/recipe`))
      .expect(200);
    expect(kept.body.lines ?? kept.body.items ?? []).toHaveLength(1);
    // Turning tracking off first makes emptying legitimate.
    await owner
      .patch(api(`/inventory/menu-items/${item}/tracking`))
      .send({ inventoryTracking: 'NONE' })
      .expect(200);
    await owner
      .patch(api(`/inventory/menu-items/${item}/recipe`))
      .send({ lines: [] })
      .expect(200);
  });
});
