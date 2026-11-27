/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped by design */
// A stock take sent twice (phone retry, double tap, two devices) must apply once
// and never surface as a 500, against a REAL Postgres. Opt-in:
//   INVENTORY_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand stock-take-idempotency
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

run('Stock take idempotency (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let ingredientId: string;

  const take = (key: string, counted: number) =>
    owner.post(`/api/v1/inventory/journal/stock-takes${q}`).send({
      idempotencyKey: key,
      lines: [{ ingredientId, counted, unit: 'PIECE' }],
    });
  const stock = async () =>
    Number(
      (
        await prisma.ingredient.findUniqueOrThrow({
          where: { id: ingredientId },
        })
      ).currentStock,
    );

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
    ingredientId = (
      await owner
        .post(`/api/v1/inventory/ingredients${q}`)
        .send({ name: `Take-${tag}`, unit: 'PIECE' })
        .expect(201)
    ).body.id;
    await owner
      .post(`/api/v1/inventory/ingredients/${ingredientId}/adjust${q}`)
      .send({ quantity: 10, note: 'opening' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('parallel copies of one stock take apply once and none fails', async () => {
    const key = `take-${tag}-parallel`;
    const rs = await Promise.all(Array.from({ length: 5 }, () => take(key, 7)));
    for (const r of rs)
      if (r.status !== 201)
        throw new Error(
          `stock take answered ${r.status}: ${JSON.stringify(r.body)}`,
        );
    expect(await stock()).toBe(7);
    expect(
      await prisma.stockTake.count({
        where: { branchId: BRANCH, idempotencyKey: key },
      }),
    ).toBe(1);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
  });

  it('a later replay of the same key returns the original and changes nothing', async () => {
    const key = `take-${tag}-replay`;
    const first = await take(key, 5).expect(201);
    const again = await take(key, 5).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await stock()).toBe(5);
  });
});
