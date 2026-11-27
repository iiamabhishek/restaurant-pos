/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped by design */
// DENY overrides through real authenticated requests: a DENY must beat a
// permission that is only implied (menu.manage -> menu.view), take effect on an
// already-open session, stay inert once expired, never leak into role listings,
// and the privilege ceiling must stop a limited manager editing a stronger
// account. Opt-in:
//   OVERRIDES_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand permission-deny-implied
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.OVERRIDES_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);

type Agent = ReturnType<typeof request.agent>;

run('DENY overrides, implied permissions and the ceiling (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: Agent;
  const roleId: Record<string, string> = {};

  const login = async (email: string) => {
    const a = request.agent(app.getHttpServer());
    await a
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);
    return a;
  };
  const makeUser = async (role: string, label: string) => {
    const email = `${label}-${tag}@demo.local`;
    const res = await owner
      .post('/api/v1/users')
      .send({
        name: `${label} ${tag}`,
        email,
        password: 'Password123!',
        roleId: roleId[role],
        branchIds: [BRANCH],
      })
      .expect(201);
    return { id: res.body.id as string, agent: await login(email) };
  };
  const setOverrides = (targetId: string, overrides: object[], as = owner) =>
    as
      .put(`/api/v1/users/${targetId}/permission-overrides`)
      .send({ overrides });
  const deny = (key: string) => ({ permissionKey: key, effect: 'DENY' });
  const viewMenu = (a: Agent) => a.get(`/api/v1/menu/categories${q}`);

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
    for (const r of roles) roleId[r.name] = r.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a DENY on menu.view beats the menu.view implied by menu.manage, on the open session', async () => {
    const chef = await makeUser('CHEF', 'chef-deny');
    await viewMenu(chef.agent).expect(200);
    await setOverrides(chef.id, [deny('menu.view')]).expect(200);
    await viewMenu(chef.agent).expect(403);
    // Unrelated privileges are untouched.
    await chef.agent.get(`/api/v1/kds/tickets${q}`).expect(200);
  });

  it('does not expose the internal marker to the user or in role listings', async () => {
    const chef = await makeUser('CHEF', 'chef-leak');
    await setOverrides(chef.id, [deny('menu.view')]).expect(200);
    const me = await chef.agent.get('/api/v1/auth/me').expect(200);
    const perms: string[] = me.body.user.permissions;
    expect(perms).not.toContain('menu.view');
    const roles = await owner.get('/api/v1/users/roles').expect(200);
    expect(JSON.stringify(roles.body)).not.toContain('"!');
  });

  it('removing the DENY restores access and an expired DENY is inert', async () => {
    const chef = await makeUser('CHEF', 'chef-expire');
    await setOverrides(chef.id, [deny('menu.view')]).expect(200);
    await viewMenu(chef.agent).expect(403);
    await setOverrides(chef.id, []).expect(200);
    await viewMenu(chef.agent).expect(200);

    const perm = await prisma.permission.findFirstOrThrow({
      where: { key: 'menu.view' },
    });
    await prisma.userPermissionOverride.create({
      data: {
        userId: chef.id,
        permissionId: perm.id,
        effect: 'DENY',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await viewMenu(chef.agent).expect(200);
  });

  it('a limited staff manager cannot edit the overrides of a stronger account', async () => {
    const role = await owner
      .post('/api/v1/roles')
      .send({
        name: `LIMITED_${tag}`.toUpperCase(),
        label: 'Limited manager',
        permissionKeys: ['users.manage', 'roles.manage', 'tables.view'],
      })
      .expect(201);
    roleId.LIMITED = role.body.id;
    const manager = await makeUser('LIMITED', 'limited');
    const stronger = await makeUser('INVENTORY_MANAGER', 'stronger');

    const res = await setOverrides(
      stronger.id,
      [deny('inventory.manage')],
      manager.agent,
    );
    expect(res.status).toBe(403);
    expect(
      await prisma.userPermissionOverride.count({
        where: { userId: stronger.id },
      }),
    ).toBe(0);
  });

  it('the owner can still manage any account', async () => {
    const target = await makeUser('INVENTORY_MANAGER', 'owner-edits');
    await setOverrides(target.id, [deny('inventory.manage')]).expect(200);
  });
});
