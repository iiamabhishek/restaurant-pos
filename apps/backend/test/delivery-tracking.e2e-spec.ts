/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Customer delivery tracking against a REAL Postgres: a signed link per delivery, a public view that shows the rider's
// position only while the delivery is live and the position is fresh, and nothing else about the rider. Opt-in:
//   TRACK_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand delivery-tracking
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.TRACK_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);

run('Delivery tracking (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  let anon: ReturnType<typeof request.agent>;
  let orderId: string;
  let riderId: string;
  let token: string;

  const view = () => anon.get(`/api/v1/public/track/${token}`);
  const setOrder = (data: object) =>
    prisma.order.update({ where: { id: orderId }, data });
  const setRider = (data: object) =>
    prisma.user.update({ where: { id: riderId }, data });

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
    anon = request.agent(app.getHttpServer());
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const mk = async (role: string, name: string) => {
      const email = `trk-${role.toLowerCase()}-${tag}@demo.local`;
      const u = (
        await owner
          .post('/api/v1/users')
          .send({
            name,
            email,
            password: 'Password123!',
            roleId: roles.find((r) => r.name === role)!.id,
            branchIds: [BRANCH],
          })
          .expect(201)
      ).body;
      return { id: u.id as string, email };
    };
    const c = await mk('CASHIER', `Cashier ${tag}`);
    cashier = request.agent(app.getHttpServer());
    await cashier
      .post('/api/v1/auth/login')
      .send({ email: c.email, password: 'Password123!' })
      .expect(201);
    riderId = (await mk('DELIVERY_STAFF', `Ravi Kumar ${tag}`)).id;
    const ownerId = (
      await prisma.user.findFirstOrThrow({
        where: { email: 'owner@demo.local' },
      })
    ).id;
    const o = await prisma.order.create({
      data: {
        branchId: BRANCH,
        orderNumber: `TRK-${tag}`,
        type: 'DELIVERY',
        status: 'OPEN',
        createdById: ownerId,
        deliveryStatus: 'ASSIGNED',
        driverId: riderId,
        deliveryLat: 12.9716,
        deliveryLng: 77.5946,
        deliveryPhone: '9999999999',
      },
    });
    orderId = o.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('only delivery managers can make a link, and only for a delivery', async () => {
    await cashier
      .post(`/api/v1/delivery/orders/${orderId}/track-link${q}`)
      .expect(403);
    const dine = await prisma.order.create({
      data: {
        branchId: BRANCH,
        orderNumber: `DI-${tag}`,
        type: 'DINE_IN',
        status: 'OPEN',
        createdById: (
          await prisma.user.findFirstOrThrow({
            where: { email: 'owner@demo.local' },
          })
        ).id,
      },
    });
    await owner
      .post(`/api/v1/delivery/orders/${dine.id}/track-link${q}`)
      .expect(404);
    const r = await owner
      .post(`/api/v1/delivery/orders/${orderId}/track-link${q}`)
      .expect(201);
    token = r.body.token;
    expect(r.body.expiresInSeconds).toBe(12 * 3600);
  });

  it('before pickup the customer sees status only, never a position', async () => {
    await setRider({
      riderOnline: true,
      riderLat: 12.9816,
      riderLng: 77.5946,
      riderLocationAt: new Date(),
    });
    const r = await view().expect(200);
    expect(r.body.status).toBe('ASSIGNED');
    expect(r.body.rider).toBeNull();
    expect(r.headers['cache-control']).toMatch(/no-store/);
  });

  it('once picked up and fresh, shows the rider first name, distance and a rough arrival', async () => {
    await setOrder({ deliveryStatus: 'PICKED_UP' });
    await setRider({ riderLocationAt: new Date() });
    const r = await view().expect(200);
    expect(r.body.rider.firstName).toBe('Ravi');
    expect(r.body.distanceKm).toBe(1.1);
    expect(r.body.etaMinutes).toBe(4);
  });

  it('shares nothing else about the rider or the order', async () => {
    const body = JSON.stringify((await view().expect(200)).body);
    expect(body).not.toContain('9999999999'); // customer phone
    expect(body).not.toContain(riderId);
    expect(Object.keys((await view()).body.rider).sort()).toEqual([
      'firstName',
      'lat',
      'lng',
      'updatedSecondsAgo',
    ]);
  });

  it('a stale or offline position is withheld', async () => {
    await setRider({ riderLocationAt: new Date(Date.now() - 20 * 60_000) });
    const stale = (await view().expect(200)).body;
    expect(stale.rider).toBeNull();
    expect(stale.note).toMatch(/not available/);
    await setRider({ riderLocationAt: new Date(), riderOnline: false });
    expect((await view().expect(200)).body.rider).toBeNull();
  });

  it('after delivery the position is gone', async () => {
    await setRider({ riderOnline: true, riderLocationAt: new Date() });
    await setOrder({ deliveryStatus: 'DELIVERED' });
    const r = (await view().expect(200)).body;
    expect(r.status).toBe('DELIVERED');
    expect(r.rider).toBeNull();
  });

  it('a made-up token, a bill link, and a link for another order are refused', async () => {
    await anon.get('/api/v1/public/track/not-a-token').expect(401);
    const dineId = (
      await prisma.order.findFirstOrThrow({
        where: { orderNumber: `DI-${tag}` },
      })
    ).id;
    const bill = await owner
      .post(`/api/v1/orders/${dineId}/bill-share${q}`)
      .send({})
      .expect(201);
    await anon.get(`/api/v1/public/track/${bill.body.token}`).expect(401); // different purpose
    // a track link for a dine-in order cannot be minted, and a valid link for a deleted order is a 404
    const r = await owner
      .post(`/api/v1/delivery/orders/${orderId}/track-link${q}`)
      .expect(201);
    await prisma.order.delete({ where: { id: orderId } });
    await anon.get(`/api/v1/public/track/${r.body.token}`).expect(404);
  });
});
