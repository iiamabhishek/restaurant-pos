BEGIN;

-- Only live or financially significant attempts need their order. Terminal
-- attempts may already outlive it, including rows restored from older backups.
CREATE OR REPLACE FUNCTION require_gateway_order() RETURNS trigger
LANGUAGE plpgsql SET app.sync_origin = '__skip' AS $$
BEGIN
  IF NOT (NEW.status::text = ANY(TG_ARGV)) THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND OLD."orderId" = NEW."orderId"
     AND OLD.status::text = ANY(TG_ARGV) THEN RETURN NULL; END IF;

  -- Take a parent row lock and create an MVCC version. A DELETE with an
  -- older REPEATABLE READ snapshot must retry, even if the child committed
  -- before the DELETE began. No business field changes. The function-local
  -- sync setting suppresses only this synthetic update, not the gateway row.
  UPDATE orders SET "updatedAt" = "updatedAt" WHERE id = NEW."orderId";
  IF NOT FOUND THEN
    RAISE foreign_key_violation USING CONSTRAINT = 'gateway_order_history',
      MESSAGE = format('insert or update on table "%s" violates foreign key constraint "gateway_order_history"', TG_TABLE_NAME),
      DETAIL = 'Protected gateway activity requires an existing order.';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER require_gateway_order
AFTER INSERT OR UPDATE OF "orderId", status ON gateway_payments
FOR EACH ROW EXECUTE FUNCTION require_gateway_order('CREATED', 'SUCCEEDED', 'NEEDS_REVIEW');

CREATE OR REPLACE TRIGGER require_gateway_order
AFTER INSERT OR UPDATE OF "orderId", status ON gateway_refunds
FOR EACH ROW EXECUTE FUNCTION require_gateway_order('PENDING', 'SUCCEEDED', 'NEEDS_REVIEW');

CREATE OR REPLACE FUNCTION retain_gateway_order() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.id = OLD.id THEN RETURN NULL; END IF;
  IF EXISTS (SELECT FROM gateway_payments WHERE "orderId" = OLD.id
             AND status IN ('CREATED', 'SUCCEEDED', 'NEEDS_REVIEW'))
     OR EXISTS (SELECT FROM gateway_refunds WHERE "orderId" = OLD.id
                AND status IN ('PENDING', 'SUCCEEDED', 'NEEDS_REVIEW')) THEN
    RAISE foreign_key_violation USING CONSTRAINT = 'gateway_order_history',
      MESSAGE = 'update or delete on table "orders" violates foreign key constraint "gateway_order_history"',
      DETAIL = 'The order has protected gateway activity.';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER retain_gateway_order
AFTER DELETE OR UPDATE OF id ON orders
FOR EACH ROW EXECUTE FUNCTION retain_gateway_order();

COMMIT;
