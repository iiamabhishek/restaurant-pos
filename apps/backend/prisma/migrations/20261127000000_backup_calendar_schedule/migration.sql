-- A pre-calendar pg_restore replaces the migration history and backups table,
-- while leaving this table in place. Keep it independent and safe to reapply.
CREATE TABLE IF NOT EXISTS "backup_schedule_state" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "schedule" JSONB,
    "retainCount" INTEGER,
    "nextScheduledAt" TIMESTAMP(3),
    "lastAttemptId" TEXT,
    "leaseUntil" TIMESTAMP(3),
    CONSTRAINT "backup_schedule_state_pkey" PRIMARY KEY ("id")
);

-- Like backup_config, the cadence and the running worker belong to this
-- installation. Sync uses this predicate for triggers, seeding and imports.
CREATE OR REPLACE FUNCTION sync_is_synced_table(t text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT t NOT LIKE 'sync\_%' AND t NOT IN
    ('_prisma_migrations', 'backups', 'backup_config', 'backup_schedule_state',
     'webhook_deliveries', 'download_stats', 'verifactu_records')
$$;

-- An older archive restores the previous sync function. If the API ran before
-- this migration was reapplied, remove the trigger it could have installed.
DROP TRIGGER IF EXISTS sync_log ON backup_schedule_state;
