-- Offline sync safety: nothing a device recorded is silently discarded.
--
-- sync_conflicts: when last-writer-wins drops one side of a concurrent edit to a business-critical row, the
-- losing version is kept here (full row) until a manager decides. Also holds flagged anomalies (refunds above
-- the amount paid, device clocks that ran ahead). Resolved rows are immutable.
-- sync_peers: devices that have synced with this server, so an owner can see when each last connected and
-- cut one off (lost PC, retired install). Names start with "sync_", so neither table is itself synced.

CREATE TABLE "sync_conflicts" (
  "id"         TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
  "dedupeKey"  TEXT NOT NULL,
  "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "kind"       TEXT NOT NULL,
  "tbl"        TEXT NOT NULL,
  "pkKey"      TEXT NOT NULL,
  "origin"     TEXT NOT NULL DEFAULT '',
  "loser"      JSONB,
  "loserOp"    CHAR(1),
  "loserTs"    TIMESTAMPTZ(3),
  "winner"     JSONB,
  "winnerTs"   TIMESTAMPTZ(3),
  "detail"     JSONB,
  "status"     TEXT NOT NULL DEFAULT 'OPEN',
  "resolution" TEXT,
  "reason"     TEXT,
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMPTZ(3),
  CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sync_conflicts_status_chk" CHECK ("status" IN ('OPEN', 'RESOLVED'))
);
CREATE UNIQUE INDEX "sync_conflicts_dedupeKey_key" ON "sync_conflicts"("dedupeKey");
CREATE INDEX "sync_conflicts_status_createdAt_idx" ON "sync_conflicts"("status", "createdAt");

CREATE OR REPLACE FUNCTION sync_conflicts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sync_conflicts rows are an audit trail and cannot be deleted';
  END IF;
  IF OLD.status = 'RESOLVED' THEN
    RAISE EXCEPTION 'a resolved sync conflict cannot be changed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sync_conflicts_guard BEFORE UPDATE OR DELETE ON "sync_conflicts"
  FOR EACH ROW EXECUTE FUNCTION sync_conflicts_guard();

CREATE TABLE "sync_peers" (
  "deviceId"      TEXT NOT NULL,
  "firstSeenAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "lastSeenAt"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "lastPullAt"    TIMESTAMPTZ(3),
  "lastPushAt"    TIMESTAMPTZ(3),
  "lastPushCount" INTEGER NOT NULL DEFAULT 0,
  "revokedAt"     TIMESTAMPTZ(3),
  CONSTRAINT "sync_peers_pkey" PRIMARY KEY ("deviceId")
);
