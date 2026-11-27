-- The audit trail is append-only. Nobody (not even the app, an admin or a stray
-- script) can delete an entry or rewrite one. The single exception is the
-- foreign key's ON DELETE SET NULL, which blanks userId when a staff account is
-- removed; every other column must stay unchanged.
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: entries cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.action IS DISTINCT FROM OLD.action
     OR NEW.entity IS DISTINCT FROM OLD.entity
     OR NEW."entityId" IS DISTINCT FROM OLD."entityId"
     OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."userId" IS NOT NULL THEN
    RAISE EXCEPTION 'audit_logs is append-only: entries cannot be edited';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
