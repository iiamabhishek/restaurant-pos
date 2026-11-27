// A plain double-entry journal built from what the restaurant recorded. Every voucher balances: the sum of its debit
// lines equals the sum of its credit lines, in exact decimals. The file is meant for an accountant or for the
// import tool of any accounting package; it does not connect to one.
import { Prisma } from '@prisma/client';

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);

export interface JournalLine {
  date: string; // YYYY-MM-DD
  voucher: string; // Sales | Refund | Expense | Purchase | Supplier payment | Purchase return
  ref: string;
  account: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  narration: string;
}

export const JOURNAL_COLUMNS = [
  'Date',
  'Voucher',
  'Reference',
  'Account',
  'Debit',
  'Credit',
  'Narration',
];

const methodAccount = (m: string) =>
  m === 'CASH' ? 'Cash in hand' : `Receipts - ${m}`;

export interface DaySales {
  date: string;
  byMethod: Map<string, Prisma.Decimal>; // money received, per payment method
  tax: Prisma.Decimal;
  tips: Prisma.Decimal;
  delivery: Prisma.Decimal;
  orders: number;
}

/** One sales voucher per day. Sales is net of tax, tips and delivery fees, and is the balancing line. */
export function salesVoucher(d: DaySales): JournalLine[] {
  const received = [...d.byMethod.values()].reduce((a, b) => a.plus(b), D(0));
  const sales = received.minus(d.tax).minus(d.tips).minus(d.delivery);
  const line = (
    account: string,
    debit: Prisma.Decimal.Value,
    credit: Prisma.Decimal.Value,
  ): JournalLine => ({
    date: d.date,
    voucher: 'Sales',
    ref: `SALES-${d.date}`,
    account,
    debit: D(debit),
    credit: D(credit),
    narration: `${d.orders} bills`,
  });
  const out: JournalLine[] = [...d.byMethod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, v]) => line(methodAccount(m), v, 0));
  out.push(line('Sales', 0, sales));
  if (!d.tax.isZero())
    out.push(line('Output tax (included in prices)', 0, d.tax));
  if (!d.tips.isZero()) out.push(line('Tips payable', 0, d.tips));
  if (!d.delivery.isZero()) out.push(line('Delivery income', 0, d.delivery));
  return out;
}

export function twoLine(
  date: string,
  voucher: string,
  ref: string,
  debitAccount: string,
  creditAccount: string,
  amount: Prisma.Decimal.Value,
  narration: string,
): JournalLine[] {
  return [
    {
      date,
      voucher,
      ref,
      account: debitAccount,
      debit: D(amount),
      credit: D(0),
      narration,
    },
    {
      date,
      voucher,
      ref,
      account: creditAccount,
      debit: D(0),
      credit: D(amount),
      narration,
    },
  ];
}

/** Total of debits minus credits for each voucher reference; every entry must be zero. */
export function imbalances(lines: JournalLine[]): Map<string, Prisma.Decimal> {
  const m = new Map<string, Prisma.Decimal>();
  for (const l of lines)
    m.set(
      `${l.voucher}|${l.ref}`,
      (m.get(`${l.voucher}|${l.ref}`) ?? D(0)).plus(l.debit).minus(l.credit),
    );
  return new Map([...m].filter(([, v]) => !v.isZero()));
}

export function toRows(lines: JournalLine[]) {
  return [...lines]
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.voucher.localeCompare(b.voucher) ||
        a.ref.localeCompare(b.ref),
    )
    .map((l) => [
      l.date,
      l.voucher,
      l.ref,
      l.account,
      l.debit.isZero() ? '' : l.debit.toFixed(2),
      l.credit.isZero() ? '' : l.credit.toFixed(2),
      l.narration,
    ]);
}
