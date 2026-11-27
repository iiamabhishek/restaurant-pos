-- Keep the existing constraint names so pg_restore --clean can replace them
-- when restoring an older archive, before its pending migrations run again.
BEGIN;

ALTER TABLE "payments"
    DROP CONSTRAINT "payments_orderId_fkey",
    ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId")
        REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refunds"
    DROP CONSTRAINT "refunds_orderId_fkey",
    ADD CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId")
        REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payments"
    DROP CONSTRAINT "supplier_payments_supplierInvoiceId_fkey",
    ADD CONSTRAINT "supplier_payments_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId")
        REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "points_ledger"
    ALTER COLUMN "customerId" DROP NOT NULL,
    DROP CONSTRAINT "points_ledger_customerId_fkey",
    ADD CONSTRAINT "points_ledger_customerId_fkey" FOREIGN KEY ("customerId")
        REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
