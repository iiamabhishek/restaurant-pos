import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { openStored, sealStored } from '../integration-hub/secret-box';

const SYNC_CTX = 'sync-state:api-key';

export interface SyncChange {
  seq?: string;
  tbl: string;
  pk: Record<string, unknown>;
  pkKey: string;
  op: 'U' | 'D';
  row: Record<string, unknown> | null;
  ts: string;
}

export interface ApplyResult {
  applied: number;
  skipped: number;
  conflicts: { tbl: string; pk: string; error: string }[];
}

interface TableMeta {
  pk: string[];
  cols: string[];
}

type Tx = Prisma.TransactionClient;
type ApplyOpts = { origin: string; tieWins: boolean };

const PULL_PAGE = 500;
const PUSH_PAGE = 200;
const MAX_FK_PASSES = 6;
const INTERVAL_MS = 30_000;
const MAX_CONFLICTS_KEPT = 50;
/** Largest batch one push may carry (a normal push is at most PUSH_PAGE rows). */
const MAX_PUSH_CHANGES = 2000;
/** A change stamped further ahead than this is from a device whose clock ran ahead; it is clamped to server time. */
const MAX_SKEW_MS = 5 * 60_000;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * Rows where losing one side of a concurrent edit costs money, stock or a customer's order. When last-writer-wins
 * drops a version of one of these, the dropped version is kept in sync_conflicts for a manager to review.
 * Insert-only rows with unique ids (a new order, a new payment) never collide, so they never appear there.
 */
export const WATCHED_TABLES = new Set([
  'orders',
  'order_items',
  'order_item_modifiers',
  'payments',
  'refunds',
  'gateway_payments',
  'gateway_refunds',
  'shifts',
  'cash_closings',
  'petty_cash_entries',
  'stock_movements',
  'stock_levels',
  'stock_takes',
  'stock_journal_entries',
  'stock_journal_lines',
  'supplier_payments',
  'points_ledger',
]);

export type ConflictKind =
  'SUPERSEDED_INCOMING' | 'OVERWRITTEN_LOCAL' | 'EXCESS_REFUND' | 'CLOCK_SKEW';

export type SyncState =
  'off' | 'server' | 'synced' | 'pending' | 'conflict' | 'offline';

/**
 * Two-way sync between a local (embedded) install and a central server.
 *
 * Changes are captured by DB triggers into sync_changes (see the
 * 20261026000000_server_sync migration). Resolution is last-writer-wins per
 * row by change timestamp; on an exact tie the server's version wins. Rows
 * arrive in arbitrary table order, so a change whose parent row hasn't
 * arrived yet (FK violation) is retried in later passes.
 */
@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SyncService.name);
  private meta: Map<string, TableMeta> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.prisma.$queryRawUnsafe('SELECT sync_install_triggers()');
    const envKey = process.env.SYNC_API_KEY?.trim();
    if (envKey) {
      // This process is the central server other devices sync with.
      await this.prisma.$executeRawUnsafe(
        `UPDATE sync_state SET role = 'server', enabled = true, "apiKey" = $1 WHERE id = 1`,
        sealStored(envKey, SYNC_CTX),
      );
      if (!(await this.state()).seeded)
        await this.prisma.$executeRawUnsafe('SELECT sync_seed()');
      this.log.log('Sync server mode enabled (SYNC_API_KEY set)');
    }
    if (process.env.NODE_ENV !== 'test') {
      this.timer = setInterval(
        () => void this.runOnce().catch(() => undefined),
        INTERVAL_MS,
      );
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async state() {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        enabled: boolean;
        role: string;
        deviceId: string;
        serverUrl: string | null;
        apiKey: string | null;
        seeded: boolean;
        lastPullSeq: bigint;
        lastPushSeq: bigint;
        lastSyncAt: Date | null;
        lastError: string | null;
        conflicts: unknown[];
      }[]
    >(`SELECT * FROM sync_state WHERE id = 1`);
    const row = rows[0];
    // Stored sealed; rows written before sealing existed are plaintext and still read.
    if (row?.apiKey) row.apiKey = openStored(row.apiKey, SYNC_CTX);
    return row;
  }

  async publicStatus() {
    const s = await this.state();
    const pending = await this.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM sync_changes WHERE seq > $1`,
      s.lastPushSeq,
    );
    const pendingChanges = s.role === 'client' ? Number(pending[0].n) : 0;
    const openConflicts = await this.openConflictCount();
    return {
      enabled: s.enabled,
      role: s.role,
      serverUrl: s.serverUrl,
      hasKey: !!s.apiKey,
      lastSyncAt: s.lastSyncAt,
      lastError: s.lastError,
      pendingChanges,
      conflicts: s.conflicts,
      openConflicts,
      state: SyncService.stateOf(s, pendingChanges, openConflicts, Date.now()),
    };
  }

  /**
   * What staff are told. "synced" means the central server took everything this device had and nothing is waiting
   * or disputed; anything else says what is still outstanding.
   */
  static stateOf(
    s: {
      enabled: boolean;
      role: string;
      lastSyncAt: Date | null;
      lastError: string | null;
    },
    pendingChanges: number,
    openConflicts: number,
    now: number,
  ): SyncState {
    if (s.role === 'server') return 'server';
    if (!s.enabled) return 'off';
    if (s.lastError) return 'offline';
    if (!s.lastSyncAt || now - new Date(s.lastSyncAt).getTime() > 5 * 60_000)
      return 'offline';
    if (pendingChanges > 0) return 'pending';
    if (openConflicts > 0) return 'conflict';
    return 'synced';
  }

  async schemaVersion(): Promise<string> {
    const r = await this.prisma.$queryRawUnsafe<{ m: string }[]>(
      `SELECT max(migration_name) AS m FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
    );
    return r[0].m;
  }

  private async tableMeta(): Promise<Map<string, TableMeta>> {
    if (this.meta) return this.meta;
    const cols = await this.prisma.$queryRawUnsafe<{ t: string; c: string }[]>(
      `SELECT c.relname AS t, a.attname AS c FROM pg_class c
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND sync_is_synced_table(c.relname)
        ORDER BY c.relname, a.attnum`,
    );
    const pks = await this.prisma.$queryRawUnsafe<{ t: string; c: string }[]>(
      `SELECT c.relname AS t, a.attname AS c FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (k.conkey)
        WHERE k.contype = 'p' AND c.relnamespace = 'public'::regnamespace`,
    );
    const m = new Map<string, TableMeta>();
    for (const { t, c } of cols) {
      if (!m.has(t)) m.set(t, { pk: [], cols: [] });
      m.get(t)!.cols.push(c);
    }
    for (const { t, c } of pks) m.get(t)?.pk.push(c);
    this.meta = m;
    return m;
  }

  private q(id: string) {
    return `"${id.replace(/"/g, '""')}"`;
  }

  /** Newest change per row; keeps log order of the winners. */
  static compact(changes: SyncChange[]): SyncChange[] {
    const latest = new Map<string, SyncChange>();
    for (const c of changes) {
      const k = `${c.tbl}\u0000${c.pkKey}`;
      const prev = latest.get(k);
      if (!prev || Date.parse(c.ts) >= Date.parse(prev.ts)) latest.set(k, c);
    }
    return [...latest.values()];
  }

  /**
   * Applies changes with last-writer-wins. `origin` is recorded in the log
   * (so the server can relay to other devices without echoing back to the
   * sender); '__skip' applies without logging (client applying a pull).
   */
  async applyChanges(
    changes: SyncChange[],
    opts: ApplyOpts,
  ): Promise<ApplyResult> {
    const meta = await this.tableMeta();
    const result: ApplyResult = { applied: 0, skipped: 0, conflicts: [] };
    const { changes: safe, clamped } = await this.clampSkewed(changes);
    if (clamped.length) await this.journalSkew(clamped, opts.origin);
    let pending = SyncService.compact(safe);
    const touchedOrders = new Set<string>();

    for (let pass = 0; pass < MAX_FK_PASSES && pending.length; pass++) {
      const retry: SyncChange[] = [];
      const lastError = new Map<SyncChange, string>();
      // Deletes after upserts on the first passes keeps cascades from
      // removing rows a later upsert in the same batch re-creates.
      const ordered = [...pending].sort(
        (a, b) => Number(a.op === 'D') - Number(b.op === 'D'),
      );
      for (let i = 0; i < ordered.length; i += PUSH_PAGE) {
        const slice = ordered.slice(i, i + PUSH_PAGE);
        await this.prisma.$transaction(
          async (tx) => {
            for (const c of slice) {
              await tx.$executeRawUnsafe('SAVEPOINT sp');
              try {
                const did = await this.applyOne(tx, c, meta, opts);
                if (did) result.applied++;
                else result.skipped++;
                const oid = c.row?.orderId;
                if (
                  (c.tbl === 'refunds' || c.tbl === 'payments') &&
                  typeof oid === 'string'
                )
                  touchedOrders.add(oid);
                await tx.$executeRawUnsafe('RELEASE SAVEPOINT sp');
              } catch (e) {
                await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp');
                const msg = e instanceof Error ? e.message : String(e);
                lastError.set(c, msg);
                if (
                  /violates foreign key|23503/.test(msg) &&
                  pass < MAX_FK_PASSES - 1
                )
                  retry.push(c);
                else
                  result.conflicts.push({
                    tbl: c.tbl,
                    pk: c.pkKey,
                    error: msg.split('\n').pop() ?? msg,
                  });
              }
            }
          },
          { timeout: 120_000, maxWait: 30_000 },
        );
      }
      pending = retry;
    }
    if (touchedOrders.size) await this.flagExcessRefunds([...touchedOrders]);
    return result;
  }

  /**
   * A device whose clock ran ahead would win every later conflict. Its changes keep their order but are stamped no
   * later than the receiver's own time, and the fact is recorded. The stamp is fixed the first time: a re-delivery of
   * the same change reuses it, so a retry cannot be re-stamped "newer" than an edit made in between.
   */
  private async clampSkewed(changes: SyncChange[]) {
    const now = Date.now();
    const clamped: { change: SyncChange; to: string }[] = [];
    const out: SyncChange[] = [];
    for (const c of changes) {
      const t = Date.parse(c.ts);
      if (!(Number.isFinite(t) && t > now + MAX_SKEW_MS)) {
        out.push(c);
        continue;
      }
      const prev = await this.prisma.$queryRawUnsafe<{ u: string | null }[]>(
        `SELECT detail->>'usedTs' AS u FROM sync_conflicts WHERE "dedupeKey" = md5($1)`,
        `CLOCK_SKEW|${c.tbl}|${c.pkKey}|${c.ts}`,
      );
      const to = prev[0]?.u ?? new Date(now).toISOString();
      clamped.push({ change: c, to });
      out.push({ ...c, ts: to });
    }
    return { changes: out, clamped };
  }

  /** Rejects anything that is not a well-formed change before it reaches SQL. */
  static validate(changes: unknown): SyncChange[] {
    if (!Array.isArray(changes))
      throw new BadRequestException('changes must be a list');
    if (changes.length > MAX_PUSH_CHANGES)
      throw new BadRequestException(
        `At most ${MAX_PUSH_CHANGES} changes per request`,
      );
    for (const c of changes as Record<string, unknown>[]) {
      const ok =
        c &&
        typeof c === 'object' &&
        typeof c.tbl === 'string' &&
        c.tbl.length <= 100 &&
        typeof c.pkKey === 'string' &&
        c.pkKey.length <= 1000 &&
        (c.op === 'U' || c.op === 'D') &&
        typeof c.ts === 'string' &&
        Number.isFinite(Date.parse(c.ts)) &&
        c.pk !== null &&
        typeof c.pk === 'object' &&
        (c.op === 'D' ? c.row == null : c.row && typeof c.row === 'object');
      if (!ok) throw new BadRequestException('Malformed change in request');
    }
    return changes as SyncChange[];
  }

  private async applyOne(
    tx: Tx,
    c: SyncChange,
    meta: Map<string, TableMeta>,
    opts: ApplyOpts,
  ): Promise<boolean> {
    const t = meta.get(c.tbl);
    if (!t || !t.pk.length) throw new Error(`unknown table ${c.tbl}`);
    const newer = await tx.$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT NOT EXISTS (
         SELECT 1 FROM sync_changes WHERE tbl = $1 AND "pkKey" = $2
            AND (ts > $3::timestamptz OR (ts = $3::timestamptz AND NOT $4::boolean))) AS ok`,
      c.tbl,
      c.pkKey,
      c.ts,
      opts.tieWins,
    );
    const watched = WATCHED_TABLES.has(c.tbl);
    if (!newer[0].ok) {
      // A newer local version stands. The incoming version is not applied, but it is not thrown away either.
      if (watched) await this.journalSuperseded(tx, c, t, opts);
      return false;
    }
    if (watched && opts.origin === '__skip')
      await this.journalOverwrittenLocal(tx, c, t);
    await tx.$queryRawUnsafe(
      `SELECT set_config('app.sync_origin', $1, true), set_config('app.sync_ts', $2, true)`,
      opts.origin,
      c.ts,
    );
    const tbl = this.q(c.tbl);
    const pkCols = t.pk.map((p) => this.q(p)).join(', ');
    if (c.op === 'D') {
      await tx.$executeRawUnsafe(
        `DELETE FROM ${tbl} WHERE (${pkCols}) = (SELECT ${pkCols} FROM jsonb_populate_record(NULL::${tbl}, $1::jsonb))`,
        JSON.stringify(c.pk),
      );
    } else {
      const sets = t.cols
        .filter((x) => !t.pk.includes(x))
        .map((x) => `${this.q(x)} = EXCLUDED.${this.q(x)}`);
      const onConflict = sets.length
        ? `ON CONFLICT (${pkCols}) DO UPDATE SET ${sets.join(', ')}`
        : `ON CONFLICT (${pkCols}) DO NOTHING`;
      await tx.$executeRawUnsafe(
        `INSERT INTO ${tbl} SELECT * FROM jsonb_populate_record(NULL::${tbl}, $1::jsonb) ${onConflict}`,
        JSON.stringify(c.row),
      );
    }
    return true;
  }

  // ---- conflict journal ----------------------------------------------------

  private async insertConflict(
    client: Pick<Tx, '$executeRawUnsafe'>,
    r: {
      dedupe: string;
      kind: ConflictKind;
      tbl: string;
      pkKey: string;
      origin?: string;
      loser?: unknown;
      loserOp?: 'U' | 'D' | null;
      loserTs?: string | Date | null;
      winner?: unknown;
      winnerTs?: string | Date | null;
      detail?: unknown;
      resolved?: string;
    },
  ) {
    const j = (v: unknown) =>
      v === undefined || v === null ? null : JSON.stringify(v);
    await client.$executeRawUnsafe(
      `INSERT INTO sync_conflicts ("dedupeKey", kind, tbl, "pkKey", origin, loser, "loserOp", "loserTs",
                                   winner, "winnerTs", detail, status, resolution, "resolvedBy", "resolvedAt")
       VALUES (md5($1), $2, $3, $4, $5, $6::jsonb, $7::char(1), $8::timestamptz, $9::jsonb, $10::timestamptz,
               $11::jsonb, $12::text, $13::text, CASE WHEN $12::text = 'RESOLVED' THEN 'system' END,
               CASE WHEN $12::text = 'RESOLVED' THEN now() END)
       ON CONFLICT ("dedupeKey") DO NOTHING`,
      r.dedupe,
      r.kind,
      r.tbl,
      r.pkKey,
      r.origin ?? '',
      j(r.loser),
      r.loserOp ?? null,
      r.loserTs ? new Date(r.loserTs).toISOString() : null,
      j(r.winner),
      r.winnerTs ? new Date(r.winnerTs).toISOString() : null,
      j(r.detail),
      r.resolved ? 'RESOLVED' : 'OPEN',
      r.resolved ?? null,
    );
  }

  private async currentRow(tx: Tx, c: SyncChange, t: TableMeta) {
    const tbl = this.q(c.tbl);
    const pkCols = t.pk.map((p) => this.q(p)).join(', ');
    const r = await tx.$queryRawUnsafe<
      { row: Record<string, unknown>; same: boolean }[]
    >(
      `SELECT to_jsonb(x) AS row, to_jsonb(x) = $2::jsonb AS same FROM ${tbl} x
        WHERE (${pkCols}) = (SELECT ${pkCols} FROM jsonb_populate_record(NULL::${tbl}, $1::jsonb))`,
      JSON.stringify(c.pk),
      JSON.stringify(c.row ?? null),
    );
    return r[0] ?? null;
  }

  /** The incoming change lost to a newer local one: keep it for review (a harmless re-delivery is not recorded). */
  private async journalSuperseded(
    tx: Tx,
    c: SyncChange,
    t: TableMeta,
    opts: ApplyOpts,
  ) {
    const cur = await this.currentRow(tx, c, t);
    if (c.op === 'U' && cur?.same) return;
    if (c.op === 'D' && !cur) return;
    const w = await tx.$queryRawUnsafe<{ ts: Date | null }[]>(
      `SELECT max(ts) AS ts FROM sync_changes WHERE tbl = $1 AND "pkKey" = $2`,
      c.tbl,
      c.pkKey,
    );
    await this.insertConflict(tx, {
      dedupe: `SUPERSEDED_INCOMING|${c.tbl}|${c.pkKey}|${c.op}|${c.ts}`,
      kind: 'SUPERSEDED_INCOMING',
      tbl: c.tbl,
      pkKey: c.pkKey,
      origin: opts.origin === '__skip' ? 'central-server' : opts.origin,
      loser: c.row,
      loserOp: c.op,
      loserTs: c.ts,
      winner: cur?.row ?? null,
      winnerTs: w[0]?.ts ?? null,
    });
  }

  /**
   * The central server's version of a row replaces an edit this device had not yet sent. The local edit is kept for
   * review and removed from the outgoing queue, so it cannot later be pushed over the winner and be recorded twice.
   */
  private async journalOverwrittenLocal(tx: Tx, c: SyncChange, t: TableMeta) {
    const pend = await tx.$queryRawUnsafe<
      { n: bigint; ts: Date | null; op: string | null }[]
    >(
      `SELECT count(*) AS n, max(ts) AS ts,
              (SELECT op FROM sync_changes q WHERE q.tbl = $1 AND q."pkKey" = $2
                  AND q.seq > (SELECT "lastPushSeq" FROM sync_state WHERE id = 1) ORDER BY q.seq DESC LIMIT 1) AS op
         FROM sync_changes
        WHERE tbl = $1 AND "pkKey" = $2 AND seq > (SELECT "lastPushSeq" FROM sync_state WHERE id = 1)`,
      c.tbl,
      c.pkKey,
    );
    if (!Number(pend[0].n)) return;
    const cur = await this.currentRow(tx, c, t);
    await tx.$executeRawUnsafe(
      `DELETE FROM sync_changes WHERE tbl = $1 AND "pkKey" = $2 AND seq > (SELECT "lastPushSeq" FROM sync_state WHERE id = 1)`,
      c.tbl,
      c.pkKey,
    );
    if (c.op === 'U' && cur?.same) return;
    await this.insertConflict(tx, {
      dedupe: `OVERWRITTEN_LOCAL|${c.tbl}|${c.pkKey}|${c.ts}|${pend[0].ts?.toISOString() ?? ''}`,
      kind: 'OVERWRITTEN_LOCAL',
      tbl: c.tbl,
      pkKey: c.pkKey,
      origin: 'this-device',
      loser: pend[0].op === 'D' ? null : (cur?.row ?? null),
      loserOp: pend[0].op === 'D' ? 'D' : 'U',
      loserTs: pend[0].ts,
      winner: c.row,
      winnerTs: c.ts,
    });
  }

  private async journalSkew(
    clamped: { change: SyncChange; to: string }[],
    origin: string,
  ) {
    for (const { change, to } of clamped) {
      try {
        await this.insertConflict(this.prisma, {
          dedupe: `CLOCK_SKEW|${change.tbl}|${change.pkKey}|${change.ts}`,
          kind: 'CLOCK_SKEW',
          tbl: change.tbl,
          pkKey: change.pkKey,
          origin: origin === '__skip' ? 'central-server' : origin,
          detail: { claimedTs: change.ts, usedTs: to },
          resolved: 'AUTO_CLAMPED',
        });
      } catch (e) {
        this.log.warn(`could not record clock skew: ${String(e)}`);
      }
    }
  }

  /** Refunds above what was paid are never executed or hidden by sync; they are flagged for the manager. */
  private async flagExcessRefunds(orderIds: string[]) {
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        { orderId: string; refunded: string; paid: string }[]
      >(
        `SELECT o.id AS "orderId", COALESCE(r.s, 0)::text AS refunded, COALESCE(p.s, 0)::text AS paid
           FROM orders o
           LEFT JOIN (SELECT "orderId", sum(amount) s FROM refunds GROUP BY 1) r ON r."orderId" = o.id
           LEFT JOIN (SELECT "orderId", sum(amount) s FROM payments GROUP BY 1) p ON p."orderId" = o.id
          WHERE o.id = ANY($1::text[]) AND COALESCE(r.s, 0) > COALESCE(p.s, 0)`,
        orderIds,
      );
      for (const r of rows)
        await this.insertConflict(this.prisma, {
          dedupe: `EXCESS_REFUND|${r.orderId}|${r.refunded}|${r.paid}`,
          kind: 'EXCESS_REFUND',
          tbl: 'orders',
          pkKey: JSON.stringify({ id: r.orderId }),
          detail: { orderId: r.orderId, refunded: r.refunded, paid: r.paid },
        });
    } catch (e) {
      this.log.warn(`refund cap check failed: ${String(e)}`);
    }
  }

  async listConflicts(
    status: 'OPEN' | 'RESOLVED' | 'ALL' = 'OPEN',
    limit = 100,
  ) {
    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT id, "createdAt", kind, tbl, "pkKey", origin, loser, "loserOp", "loserTs", winner, "winnerTs", detail,
              status, resolution, reason, "resolvedBy", "resolvedAt"
         FROM sync_conflicts WHERE ($1 = 'ALL' OR status = $1)
        ORDER BY "createdAt" DESC LIMIT $2`,
      status,
      Math.min(Math.max(limit, 1), 500),
    );
    return rows;
  }

  async openConflictCount(): Promise<number> {
    const r = await this.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM sync_conflicts WHERE status = 'OPEN'`,
    );
    return Number(r[0].n);
  }

  /**
   * A manager's decision on one conflict. KEEP_CURRENT confirms the version that is in place. APPLY_LOSER writes the
   * kept version back as a new change stamped now, so it wins and then travels to every other device. Either way the
   * decision, who made it and why are stored on the (then immutable) conflict row.
   */
  async resolveConflict(
    id: string,
    action: 'KEEP_CURRENT' | 'APPLY_LOSER',
    reason: string,
    actorId: string,
  ) {
    if (action !== 'KEEP_CURRENT' && action !== 'APPLY_LOSER')
      throw new BadRequestException(
        'action must be KEEP_CURRENT or APPLY_LOSER',
      );
    const why = (reason ?? '').trim();
    if (why.length < 3 || why.length > 500)
      throw new BadRequestException('Give a reason (3 to 500 characters)');
    const meta = await this.tableMeta();
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRawUnsafe<
          {
            kind: ConflictKind;
            tbl: string;
            pkKey: string;
            loser: Record<string, unknown> | null;
            loserOp: 'U' | 'D' | null;
            status: string;
          }[]
        >(
          `SELECT kind, tbl, "pkKey", loser, "loserOp", status FROM sync_conflicts WHERE id = $1 FOR UPDATE`,
          id,
        );
        const c = rows[0];
        if (!c) throw new BadRequestException('Conflict not found');
        if (c.status !== 'OPEN')
          throw new ConflictException('This conflict was already resolved');
        if (action === 'APPLY_LOSER') {
          if (
            c.kind !== 'SUPERSEDED_INCOMING' &&
            c.kind !== 'OVERWRITTEN_LOCAL'
          )
            throw new BadRequestException(
              'This item has no saved version to restore; confirm it instead',
            );
          const change: SyncChange = {
            tbl: c.tbl,
            pk: JSON.parse(c.pkKey) as Record<string, unknown>,
            pkKey: c.pkKey,
            op: c.loserOp === 'D' ? 'D' : 'U',
            row: c.loserOp === 'D' ? null : c.loser,
            ts: new Date().toISOString(),
          };
          await tx.$executeRawUnsafe('SAVEPOINT restore_loser');
          try {
            const did = await this.applyOne(tx, change, meta, {
              origin: 'local',
              tieWins: false,
            });
            if (!did) throw new Error('a newer change exists for this record');
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT restore_loser');
          } catch (e) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT restore_loser');
            throw new ConflictException(
              `The saved version could not be restored: ${(e instanceof Error ? e.message : String(e)).split('\n').pop()}`,
            );
          }
        }
        await tx.$executeRawUnsafe(
          `UPDATE sync_conflicts SET status = 'RESOLVED', resolution = $2, reason = $3, "resolvedBy" = $4, "resolvedAt" = now()
            WHERE id = $1`,
          id,
          action,
          why,
          actorId,
        );
        return { id, action, kind: c.kind, tbl: c.tbl, pkKey: c.pkKey };
      },
      { timeout: 30_000 },
    );
  }

  // ---- peers (server side) -------------------------------------------------

  /** Records that a device connected. A device the owner removed is refused before any data moves. */
  async touchPeer(device: string, kind: 'pull' | 'push', pushed = 0) {
    if (!DEVICE_ID.test(device))
      throw new BadRequestException('Invalid device id');
    const r = await this.prisma.$queryRawUnsafe<{ revokedAt: Date | null }[]>(
      `INSERT INTO sync_peers ("deviceId", "lastPullAt", "lastPushAt", "lastPushCount")
       VALUES ($1, CASE WHEN $2 = 'pull' THEN now() END, CASE WHEN $2 = 'push' THEN now() END, $3::int)
       ON CONFLICT ("deviceId") DO UPDATE SET "lastSeenAt" = now(),
         "lastPullAt" = CASE WHEN $2 = 'pull' THEN now() ELSE sync_peers."lastPullAt" END,
         "lastPushAt" = CASE WHEN $2 = 'push' THEN now() ELSE sync_peers."lastPushAt" END,
         "lastPushCount" = CASE WHEN $2 = 'push' THEN $3::int ELSE sync_peers."lastPushCount" END
       RETURNING "revokedAt"`,
      device,
      kind,
      pushed,
    );
    if (r[0]?.revokedAt)
      throw new ForbiddenException({
        message: 'This device was removed by the server owner.',
        code: 'PEER_REVOKED',
      });
  }

  async listPeers() {
    return this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT "deviceId", "firstSeenAt", "lastSeenAt", "lastPullAt", "lastPushAt", "lastPushCount", "revokedAt"
         FROM sync_peers ORDER BY "lastSeenAt" DESC`,
    );
  }

  async setPeerRevoked(device: string, revoked: boolean) {
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE sync_peers SET "revokedAt" = CASE WHEN $2::boolean THEN now() END WHERE "deviceId" = $1`,
      device,
      revoked,
    );
    if (!n) throw new BadRequestException('Unknown device');
  }

  // ---- server side -------------------------------------------------------

  async pull(since: bigint, device: string, limit = PULL_PAGE) {
    await this.touchPeer(device, 'pull');
    const rows = await this.prisma.$queryRawUnsafe<
      {
        seq: string;
        tbl: string;
        pk: Record<string, unknown>;
        pkKey: string;
        op: 'U' | 'D';
        row: Record<string, unknown> | null;
        ts: Date;
        origin: string;
      }[]
    >(
      `SELECT seq::text, tbl, pk, "pkKey", op, row, ts, origin FROM sync_changes
        WHERE seq > $1 ORDER BY sync_changes.seq LIMIT $2`,
      since,
      limit,
    );
    const nextSeq = rows.length ? rows[rows.length - 1].seq : since.toString();
    const mine = rows
      .filter((r) => r.origin !== device)
      .map((r) => ({ ...r, ts: r.ts.toISOString() }));
    return {
      changes: SyncService.compact(mine),
      nextSeq,
      hasMore: rows.length === limit,
    };
  }

  async push(device: string, changes: unknown) {
    const valid = SyncService.validate(changes);
    await this.touchPeer(device, 'push', valid.length);
    return this.applyChanges(valid, { origin: device, tieWins: false });
  }

  // ---- client side -------------------------------------------------------

  private async call<T>(
    s: { serverUrl: string | null; apiKey: string | null },
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    if (!s.serverUrl || !s.apiKey)
      throw new Error('Server address and sync key are required');
    const res = await fetch(
      `${s.serverUrl.replace(/\/+$/, '')}/api/v1/sync-peer/${path}`,
      {
        ...init,
        headers: {
          'content-type': 'application/json',
          'x-sync-key': s.apiKey,
          ...init.headers,
        },
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as {
        code?: string;
      } | null;
      if (body?.code === 'PEER_REVOKED')
        throw new Error(
          'This PC was removed from the server by its owner. Re-connect it from Settings > Server sync.',
        );
    }
    if (res.status === 401 || res.status === 403)
      throw new Error('Server rejected the sync key');
    if (!res.ok) throw new Error(`Server answered HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async testConnection(serverUrl: string, apiKey: string) {
    const r = await this.call<{ ok: boolean; role: string; schema: string }>(
      { serverUrl, apiKey },
      'ping',
    );
    const local = await this.schemaVersion();
    if (r.role !== 'server')
      throw new Error(
        'That address is not a sync server (SYNC_API_KEY is not set there)',
      );
    if (r.schema !== local) {
      throw new Error(
        `App versions differ (this PC: ${local}, server: ${r.schema}). Update both to the same version first.`,
      );
    }
    return { ok: true, schema: r.schema };
  }

  /** mode 'adopt': replace local data with the server's. 'merge': keep and merge both. */
  async enable(serverUrl: string, apiKey: string, mode: 'adopt' | 'merge') {
    // A cycle already in flight holds the previous sequence numbers.
    await this.running?.catch(() => undefined);
    await this.testConnection(serverUrl, apiKey);
    const meta = await this.tableMeta();
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE sync_state SET enabled = false, role = 'client', "serverUrl" = $1, "apiKey" = $2,
             "lastPullSeq" = 0, "lastPushSeq" = 0, "lastError" = NULL, conflicts = '[]' WHERE id = 1`,
          serverUrl.replace(/\/+$/, ''),
          sealStored(apiKey, SYNC_CTX),
        );
        await tx.$executeRawUnsafe('DELETE FROM sync_changes');
        if (mode === 'adopt') {
          await tx.$queryRawUnsafe(
            `SELECT set_config('app.sync_origin', '__skip', true)`,
          );
          // The append-only VERI*FACTU chain can't be replaced; an empty one
          // only needs its truncate guard stepped around.
          const chain = await tx.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT count(*) AS n FROM verifactu_records`,
          );
          if (Number(chain[0].n) > 0) {
            throw new Error(
              'This PC already has VERI*FACTU invoice records, which cannot be replaced. Use "merge" instead.',
            );
          }
          await tx.$executeRawUnsafe(
            `ALTER TABLE verifactu_records DISABLE TRIGGER USER`,
          );
          const tables = [...meta.keys()].map((t) => this.q(t)).join(', ');
          await tx.$executeRawUnsafe(
            `TRUNCATE ${tables}, verifactu_records CASCADE`,
          );
          await tx.$executeRawUnsafe(
            `ALTER TABLE verifactu_records ENABLE TRIGGER USER`,
          );
        }
        await tx.$executeRawUnsafe(
          `UPDATE sync_state SET enabled = true, seeded = ${mode === 'adopt'} WHERE id = 1`,
        );
        if (mode === 'merge') await tx.$executeRawUnsafe('SELECT sync_seed()');
      },
      { timeout: 120_000 },
    );
    return this.runOnce();
  }

  async disable() {
    await this.running?.catch(() => undefined);
    await this.prisma.$executeRawUnsafe(
      `UPDATE sync_state SET enabled = false, "lastError" = NULL WHERE id = 1 AND role = 'client'`,
    );
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM sync_changes WHERE (SELECT role FROM sync_state) = 'client'`,
    );
  }

  runOnce(): Promise<{
    pulled: number;
    pushed: number;
    conflicts: number;
  } | null> {
    if (this.running) return this.running as Promise<never>;
    const p = this.cycle().finally(() => {
      this.running = null;
    });
    this.running = p;
    return p;
  }

  private async cycle() {
    const s = await this.state();
    if (!s.enabled || s.role !== 'client') return null;
    let pulled = 0;
    let pushed = 0;
    const conflicts: ApplyResult['conflicts'] = [];
    try {
      await this.testConnection(s.serverUrl!, s.apiKey!);

      let since = s.lastPullSeq;
      for (;;) {
        const page = await this.call<{
          changes: SyncChange[];
          nextSeq: string;
          hasMore: boolean;
        }>(s, `pull?since=${since}&device=${encodeURIComponent(s.deviceId)}`);
        const r = await this.applyChanges(page.changes, {
          origin: '__skip',
          tieWins: true,
        });
        pulled += r.applied;
        conflicts.push(...r.conflicts);
        since = BigInt(page.nextSeq);
        await this.prisma.$executeRawUnsafe(
          `UPDATE sync_state SET "lastPullSeq" = $1 WHERE id = 1`,
          since,
        );
        if (!page.hasMore) break;
      }

      let pushedTo = s.lastPushSeq;
      for (;;) {
        const rows = await this.prisma.$queryRawUnsafe<
          {
            seq: string;
            tbl: string;
            pk: Record<string, unknown>;
            pkKey: string;
            op: 'U' | 'D';
            row: Record<string, unknown> | null;
            ts: Date;
          }[]
        >(
          `SELECT seq::text, tbl, pk, "pkKey", op, row, ts FROM sync_changes WHERE seq > $1 ORDER BY sync_changes.seq LIMIT $2`,
          pushedTo,
          PUSH_PAGE,
        );
        if (!rows.length) break;
        const changes = SyncService.compact(
          rows.map((r) => ({ ...r, ts: r.ts.toISOString() })),
        );
        const r = await this.call<ApplyResult>(s, 'push', {
          method: 'POST',
          body: JSON.stringify({ device: s.deviceId, changes }),
        });
        pushed += r.applied;
        conflicts.push(...r.conflicts);
        pushedTo = BigInt(rows[rows.length - 1].seq);
        await this.prisma.$executeRawUnsafe(
          `UPDATE sync_state SET "lastPushSeq" = $1 WHERE id = 1`,
          pushedTo,
        );
        if (rows.length < PUSH_PAGE) break;
      }

      const kept = [
        ...conflicts.map((c) => ({ ...c, at: new Date().toISOString() })),
        ...(s.conflicts ?? []),
      ].slice(0, MAX_CONFLICTS_KEPT);
      await this.prisma.$executeRawUnsafe(
        `UPDATE sync_state SET "lastSyncAt" = now(), "lastError" = NULL, conflicts = $1::jsonb WHERE id = 1`,
        JSON.stringify(kept),
      );
      // Everything up to lastPushSeq is on the server; keep the log small.
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM sync_changes WHERE seq <= (SELECT "lastPushSeq" FROM sync_state) AND ts < now() - interval '1 day'`,
      );
      return { pulled, pushed, conflicts: conflicts.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`sync failed: ${msg}`);
      await this.prisma.$executeRawUnsafe(
        `UPDATE sync_state SET "lastError" = $1 WHERE id = 1`,
        msg,
      );
      throw e;
    }
  }
}
