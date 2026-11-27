-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PettyCashKind" AS ENUM ('TOPUP', 'VOUCHER', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "status" "ExpenseStatus" NOT NULL DEFAULT 'APPROVED';

-- CreateTable
CREATE TABLE "petty_cash_entries" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" "PettyCashKind" NOT NULL,
    "delta" DECIMAL(12,2) NOT NULL,
    "countedCash" DECIMAL(12,2),
    "bookBalance" DECIMAL(12,2),
    "category" TEXT,
    "payee" TEXT,
    "receiptRef" TEXT,
    "note" TEXT,
    "expenseId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientRequestId" TEXT,

    CONSTRAINT "petty_cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "petty_cash_entries_expenseId_key" ON "petty_cash_entries"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "petty_cash_entries_clientRequestId_key" ON "petty_cash_entries"("clientRequestId");

-- CreateIndex
CREATE INDEX "petty_cash_entries_branchId_createdAt_idx" ON "petty_cash_entries"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "expenses_branchId_status_idx" ON "expenses"("branchId", "status");

-- AddForeignKey
ALTER TABLE "petty_cash_entries" ADD CONSTRAINT "petty_cash_entries_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_entries" ADD CONSTRAINT "petty_cash_entries_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_entries" ADD CONSTRAINT "petty_cash_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

