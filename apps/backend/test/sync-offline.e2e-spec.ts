/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- raw SQL fixtures */
import { execSync } from 'node:child_process';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { PrismaService } from './../src/prisma/prisma.service';
import { SyncService } from './../src/sync/sync.service';

/**
 * Offline-first sync between a central server and a local install, each a REAL Postgres database, joined by a small
 * HTTP shim that exposes the real peer protocol (ping/pull/push) so SyncService.cycle() itself is what runs.
 * Failure injection (server down, connection dropped mid-batch) is done in the shim.
 */
const run = process.env.SYNC_OFFLINE_E2E ? describe : describe.skip;
jest.setTimeout(240_000);

const KEY = 'k'.repeat(24) + randomBytes(4).toString('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function urlFor(base: string, db: string) {
  const u = new URL(base);
  u.pathname = `/${db}`;
  u.search = '';
  return u.toString();
}

run('offline sync: server and local install (e2e)', () => {
  const tag = randomBytes(3).toString('hex');
  const dbSrv = `orr_sync_srv_${tag}`;
  const dbCli = `orr_sync_cli_${tag}`;
  const base = process.env.DATABASE_URL!;
  let admin: PrismaService;
  let A: PrismaService; // central server
  let B: PrismaService; // local install
  let server: SyncService;
  let client: SyncService;
  let shim: http.Server;
  const hooks = { down: false, dropPushAt: 0, pushes: 0 };
  let ownerId: string;
  let n = 0;

  const mkOrder = (p: PrismaService, notes?: string) =>
    p.order.create({
      data: {
        branchId: 'demo-branch',
        orderNumber: `T${tag}-${++n}`,
        createdById: ownerId,
        subtotal: 100,
        totalAmount: 100,
        notes,
      },
    });
  const note = async (p: PrismaService, id: string) =>
    (await p.order.findUnique({ where: { id }, select: { notes: true } }))
      ?.notes;
  const conflicts = (svc: SyncService, status: any = 'OPEN') =>
    svc.listConflicts(status, 500) as Promise<any[]>;
  const sync = () => client.runOnce();

  beforeAll(async () => {
    process.env.JWT_SECRET ||= randomBytes(32).toString('hex');
    admin = new PrismaService({ datasources: { db: { url: base } } });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbSrv}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbCli}"`);
    for (const db of [dbSrv, dbCli])
      execSync('npx prisma migrate deploy', {
        env: { ...process.env, DATABASE_URL: urlFor(base, db) },
        stdio: 'ignore',
      });
    execSync('npx ts-node prisma/seed.ts', {
      env: { ...process.env, DATABASE_URL: urlFor(base, dbSrv) },
      stdio: 'ignore',
    });
    A = new PrismaService({
      datasources: { db: { url: urlFor(base, dbSrv) } },
    });
    B = new PrismaService({
      datasources: { db: { url: urlFor(base, dbCli) } },
    });
    await A.$connect();
    await B.$connect();
    server = new SyncService(A);
    client = new SyncService(B);
    process.env.SYNC_API_KEY = KEY;
    await server.onModuleInit();
    delete process.env.SYNC_API_KEY;
    ownerId = (
      await A.user.findFirstOrThrow({ where: { email: 'owner@demo.local' } })
    ).id;

    shim = http.createServer((req, res) => {
      void (async () => {
        if (hooks.down) return req.socket.destroy();
        const url = new URL(req.url!, 'http://shim');
        if (req.headers['x-sync-key'] !== KEY) {
          res.writeHead(401);
          return res.end();
        }
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = chunks.length
            ? JSON.parse(Buffer.concat(chunks).toString())
            : undefined;
          let out: unknown;
          if (url.pathname.endsWith('/ping'))
            out = {
              ok: true,
              role: 'server',
              schema: await server.schemaVersion(),
            };
          else if (url.pathname.endsWith('/pull'))
            out = await server.pull(
              BigInt(url.searchParams.get('since')!),
              url.searchParams.get('device')!,
            );
          else {
            hooks.pushes++;
            if (hooks.dropPushAt && hooks.pushes === hooks.dropPushAt)
              return req.socket.destroy();
            out = await server.push(body.device, body.changes);
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(out));
        } catch (e) {
          const status = e instanceof HttpException ? e.getStatus() : 500;
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify(e instanceof HttpException ? e.getResponse() : {}),
          );
        }
      })();
    });
    await new Promise<void>((r) => shim.listen(0, '127.0.0.1', r));
    const port = (shim.address() as any).port;
    await client.enable(`http://127.0.0.1:${port}`, KEY, 'adopt');
  });

  afterAll(async () => {
    shim?.close();
    await A?.$disconnect();
    await B?.$disconnect();
    for (const db of [dbSrv, dbCli])
      await admin
        ?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`)
        .catch(() => undefined);
    await admin?.$disconnect();
  });

  it('adopts the server data on first connect and reports synced', async () => {
    expect(await B.user.count({ where: { email: 'owner@demo.local' } })).toBe(
      1,
    );
    const st = await client.publicStatus();
    expect(st.state).toBe('synced');
    expect(st.pendingChanges).toBe(0);
  });

  it('copies every row of every synced table on first connect', async () => {
    const tables = await A.$queryRawUnsafe<{ t: string }[]>(
      `SELECT c.relname AS t FROM pg_class c JOIN pg_constraint k ON k.conrelid = c.oid AND k.contype = 'p'
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND sync_is_synced_table(c.relname)`,
    );
    let total = 0;
    const wrong: string[] = [];
    for (const { t } of tables) {
      const a = Number(
        (await A.$queryRawUnsafe<any[]>(`SELECT count(*) n FROM "${t}"`))[0].n,
      );
      const b = Number(
        (await B.$queryRawUnsafe<any[]>(`SELECT count(*) n FROM "${t}"`))[0].n,
      );
      total += a;
      if (a !== b) wrong.push(`${t}: server ${a}, local ${b}`);
    }
    expect(wrong).toEqual([]);
    expect(total).toBeGreaterThan(100);
  });

  it('keeps working with the server unreachable, says so, then converges (two devices, both create orders)', async () => {
    hooks.down = true;
    const oa = await mkOrder(A);
    const ob = await mkOrder(B);
    await expect(sync()).rejects.toBeTruthy();
    const off = await client.publicStatus();
    expect(off.state).toBe('offline');
    expect(off.pendingChanges).toBeGreaterThan(0); // saved on this device, NOT on the server
    expect(await B.order.findUnique({ where: { id: ob.id } })).toBeTruthy();

    hooks.down = false;
    await sync();
    for (const p of [A, B]) {
      expect(await p.order.findUnique({ where: { id: oa.id } })).toBeTruthy();
      expect(await p.order.findUnique({ where: { id: ob.id } })).toBeTruthy();
    }
    const ok = await client.publicStatus();
    expect(ok.state).toBe('synced');
    expect(ok.pendingChanges).toBe(0);
    expect(ok.lastError).toBeNull();
  });

  it('a concurrent edit that loses is kept, shown as a conflict, and a manager can restore it (immutably)', async () => {
    const o = await mkOrder(A, 'original');
    await sync();
    await A.order.update({
      where: { id: o.id },
      data: { notes: 'from server' },
    });
    await sleep(30);
    await B.order.update({
      where: { id: o.id },
      data: { notes: 'from device' },
    });
    await sync();

    // Newest edit wins on both sides ...
    expect(await note(A, o.id)).toBe('from device');
    expect(await note(B, o.id)).toBe('from device');
    // ... but the losing version is not gone.
    const open = (await conflicts(client)).filter((c) => c.tbl === 'orders');
    expect(open).toHaveLength(1);
    expect(open[0].kind).toBe('SUPERSEDED_INCOMING');
    expect(open[0].loser.notes).toBe('from server');
    expect(open[0].winner.notes).toBe('from device');
    expect((await client.publicStatus()).state).toBe('conflict');

    await expect(
      client.resolveConflict(open[0].id, 'APPLY_LOSER', 'x', 'u1'),
    ).rejects.toThrow(/reason/i);
    await client.resolveConflict(
      open[0].id,
      'APPLY_LOSER',
      'Server note was right',
      ownerId,
    );
    await sync();
    expect(await note(B, o.id)).toBe('from server');
    expect(await note(A, o.id)).toBe('from server');

    const done = (await conflicts(client, 'RESOLVED')).find(
      (c) => c.id === open[0].id,
    );
    expect(done.resolution).toBe('APPLY_LOSER');
    expect(done.reason).toBe('Server note was right');
    expect(done.resolvedBy).toBe(ownerId);
    await expect(
      client.resolveConflict(
        open[0].id,
        'KEEP_CURRENT',
        'again please',
        ownerId,
      ),
    ).rejects.toThrow(/already resolved/);
    await expect(
      B.$executeRawUnsafe(
        `UPDATE sync_conflicts SET reason = 'edited' WHERE id = '${open[0].id}'`,
      ),
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      B.$executeRawUnsafe(
        `DELETE FROM sync_conflicts WHERE id = '${open[0].id}'`,
      ),
    ).rejects.toThrow(/cannot be deleted/);
  });

  it('an unsent local edit replaced by a newer server edit is kept once, not pushed over the winner', async () => {
    const o = await mkOrder(A, 'start');
    await sync();
    await B.order.update({
      where: { id: o.id },
      data: { notes: 'client first' },
    });
    await sleep(30);
    await A.order.update({
      where: { id: o.id },
      data: { notes: 'server later' },
    });
    await sync();
    expect(await note(B, o.id)).toBe('server later');
    expect(await note(A, o.id)).toBe('server later');
    const mine = (await conflicts(client)).filter((c) =>
      c.pkKey.includes(o.id),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe('OVERWRITTEN_LOCAL');
    expect(mine[0].loser.notes).toBe('client first');
    expect(
      (await conflicts(server)).filter((c) => c.pkKey.includes(o.id)),
    ).toHaveLength(0);
    await client.resolveConflict(
      mine[0].id,
      'KEEP_CURRENT',
      'server edit is current',
      ownerId,
    );
  });

  it('two refunds recorded offline against one payment are both kept and flagged, never silently merged', async () => {
    const o = await mkOrder(A);
    await A.payment.create({
      data: { orderId: o.id, method: 'CASH', amount: 100 },
    });
    await sync();
    await A.refund.create({
      data: { orderId: o.id, amount: 60, method: 'CASH', createdById: ownerId },
    });
    await B.refund.create({
      data: { orderId: o.id, amount: 60, method: 'CASH', createdById: ownerId },
    });
    await sync();
    for (const p of [A, B])
      expect(await p.refund.count({ where: { orderId: o.id } })).toBe(2);
    for (const svc of [server, client]) {
      const f = (await conflicts(svc)).filter(
        (c) => c.kind === 'EXCESS_REFUND' && c.detail.orderId === o.id,
      );
      expect(f).toHaveLength(1);
      expect(Number(f[0].detail.refunded)).toBe(120);
      expect(Number(f[0].detail.paid)).toBe(100);
    }
    // a flag has no saved version to restore, only to acknowledge
    const f = (await conflicts(client)).find(
      (c) => c.kind === 'EXCESS_REFUND' && c.detail.orderId === o.id,
    );
    await expect(
      client.resolveConflict(f.id, 'APPLY_LOSER', 'nope nope', ownerId),
    ).rejects.toThrow(/no saved version/);
    await client.resolveConflict(
      f.id,
      'KEEP_CURRENT',
      'second refund reversed in cash',
      ownerId,
    );
  });

  it('delivering the same changes again changes nothing and raises no conflict', async () => {
    const o = await mkOrder(A, 'dup');
    const page = await server.pull(0n, 'device-dup-0001', 5000);
    const mine = page.changes.filter((c) => c.pkKey.includes(o.id));
    expect(mine.length).toBeGreaterThan(0);
    const before = (await conflicts(server)).length;
    const orders = await A.order.count();
    for (let i = 0; i < 3; i++) await server.push('device-dup-0002', mine);
    expect(await A.order.count()).toBe(orders);
    expect((await conflicts(server)).length).toBe(before);
  });

  it('a device whose clock is a day ahead cannot win every later conflict', async () => {
    const o = await mkOrder(A, 'clock');
    const [row] = await A.$queryRawUnsafe<any[]>(
      `SELECT to_jsonb(o) AS r FROM orders o WHERE id = '${o.id}'`,
    );
    const [k] = await A.$queryRawUnsafe<any[]>(
      `SELECT "pkKey" FROM sync_changes WHERE tbl = 'orders' AND "pkKey" LIKE '%${o.id}%' LIMIT 1`,
    );
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const res = await server.push('device-skew-0001', [
      {
        tbl: 'orders',
        pk: { id: o.id },
        pkKey: k.pkKey,
        op: 'U',
        row: { ...row.r, notes: 'future' },
        ts: future,
      },
    ]);
    expect(res.applied).toBe(1);
    const [m] = await A.$queryRawUnsafe<any[]>(
      `SELECT max(ts) AS ts FROM sync_changes WHERE tbl = 'orders' AND "pkKey" = $1`,
      k.pkKey,
    );
    expect(new Date(m.ts).getTime()).toBeLessThan(Date.now() + 60_000);
    const skew = (await conflicts(server, 'RESOLVED')).find(
      (c) => c.kind === 'CLOCK_SKEW' && c.pkKey === k.pkKey,
    );
    expect(skew.resolution).toBe('AUTO_CLAMPED');
    await sleep(30);
    await A.order.update({
      where: { id: o.id },
      data: { notes: 'real later edit' },
    });
    expect(await note(A, o.id)).toBe('real later edit');
    const again = await server.push('device-skew-0001', [
      {
        tbl: 'orders',
        pk: { id: o.id },
        pkKey: k.pkKey,
        op: 'U',
        row: { ...row.r, notes: 'future' },
        ts: future,
      },
    ]);
    expect(again.applied).toBe(0); // the genuinely later edit stands
    expect(await note(A, o.id)).toBe('real later edit');
  });

  it('a removed device is refused before any data moves, and can be restored', async () => {
    const dev = 'device-gone-0001';
    await server.touchPeer(dev, 'pull');
    await server.setPeerRevoked(dev, true);
    await expect(server.pull(0n, dev)).rejects.toMatchObject({
      response: { code: 'PEER_REVOKED' },
    });
    await expect(server.push(dev, [])).rejects.toMatchObject({
      response: { code: 'PEER_REVOKED' },
    });
    await server.setPeerRevoked(dev, false);
    await expect(server.pull(0n, dev)).resolves.toBeTruthy();
    expect(
      (await server.listPeers()).some((p: any) => p.deviceId === dev),
    ).toBe(true);
  });

  it('rejects malformed, oversized, unknown-table and injection-shaped payloads without harm', async () => {
    const dev = 'device-bad-00001';
    await expect(server.push(dev, 'nope')).rejects.toThrow(/list/);
    await expect(server.push(dev, [{ tbl: 1 }] as never)).rejects.toThrow(
      /Malformed/,
    );
    await expect(
      server.push(dev, [
        { tbl: 'orders', pk: {}, pkKey: '{}', op: 'U', row: null, ts: 'bad' },
      ] as never),
    ).rejects.toThrow(/Malformed/);
    await expect(
      server.push(dev, new Array(2001).fill({}) as never),
    ).rejects.toThrow(/At most/);
    await expect(server.push('x', [])).rejects.toThrow(/device id/);
    const res = await server.push(dev, [
      {
        tbl: 'orders"; DROP TABLE orders; --',
        pk: { id: '1' },
        pkKey: '{"id":"1"}',
        op: 'U',
        row: { id: '1' },
        ts: new Date().toISOString(),
      },
    ]);
    expect(res.conflicts).toHaveLength(1);
    expect(await A.order.count()).toBeGreaterThan(0);
  });

  it('a connection dropped halfway through a large batch loses nothing and duplicates nothing', async () => {
    const before = await A.order.count();
    const data = Array.from({ length: 450 }, () => ({
      branchId: 'demo-branch',
      orderNumber: `T${tag}-${++n}`,
      createdById: ownerId,
      subtotal: 10,
      totalAmount: 10,
    }));
    await B.order.createMany({ data });
    hooks.pushes = 0;
    hooks.dropPushAt = 2;
    await expect(sync()).rejects.toBeTruthy();
    hooks.dropPushAt = 0;
    const partial = await A.order.count();
    expect(partial).toBeGreaterThan(before); // first page landed
    expect(partial).toBeLessThan(before + 450); // the rest is still waiting
    expect((await client.publicStatus()).state).toBe('offline');
    expect((await client.publicStatus()).pendingChanges).toBeGreaterThan(0);

    await sync();
    expect(await A.order.count()).toBe(before + 450);
    await sync(); // a further cycle is a no-op
    expect(await A.order.count()).toBe(before + 450);
    expect(await B.order.count()).toBe(await A.order.count());
    const dupes = await A.$queryRawUnsafe<any[]>(
      `SELECT "orderNumber" FROM orders GROUP BY 1 HAVING count(*) > 1`,
    );
    expect(dupes).toHaveLength(0);
  });
  it('pulls a backlog larger than one page without skipping rows (cursor paging)', async () => {
    const data = Array.from({ length: 700 }, () => ({
      branchId: 'demo-branch',
      orderNumber: `T${tag}-${++n}`,
      createdById: ownerId,
      subtotal: 5,
      totalAmount: 5,
    }));
    await A.order.createMany({ data });
    await sync();
    expect(await B.order.count()).toBe(await A.order.count());
    const ids = new Set(
      (await B.order.findMany({ select: { id: true } })).map((o) => o.id),
    );
    const missing = (await A.order.findMany({ select: { id: true } })).filter(
      (o) => !ids.has(o.id),
    );
    expect(missing).toHaveLength(0);
  });
});
