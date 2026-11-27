// Price variance for goods receipts, as pure functions: what we agreed to pay (the purchase order), what the
// receipt recorded, what we paid last time for the same item, and how a supplier invoice compares to the receipt.
// Exact decimal arithmetic throughout; percentages are rounded to one decimal only for display.
import { Prisma } from '@prisma/client';

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);

export interface ReceiptLine {
  id: string;
  grnNumber: string;
  receivedAt: Date;
  supplierName: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  quantity: Prisma.Decimal.Value;
  unitCost: Prisma.Decimal.Value; // price recorded on the receipt
  poUnitCost: Prisma.Decimal.Value | null; // price on the purchase order, when there was one
}

export interface VarianceRow {
  grnNumber: string;
  receivedAt: Date;
  supplier: string;
  ingredient: string;
  unit: string;
  quantity: string;
  poUnitCost: string | null;
  receivedUnitCost: string;
  lastUnitCost: string | null;
  poVariancePct: number | null;
  lastVariancePct: number | null;
  /** Extra money paid against the order price for this line (negative = paid less). */
  poVarianceAmount: string | null;
  flagged: boolean;
}

/** (now - base) / base as a percentage, or null when there is nothing to compare to. */
export function pctChange(
  now: Prisma.Decimal.Value,
  base: Prisma.Decimal.Value | null,
): number | null {
  if (base == null) return null;
  const b = D(base);
  if (b.isZero()) return null;
  return D(now).minus(b).div(b).mul(100).toDecimalPlaces(1).toNumber();
}

/**
 * `history` must hold every receipt line of the same items, oldest first, including lines before the window, so
 * "last price" is the most recent earlier receipt of the same item.
 */
export function computeVariance(
  window: ReceiptLine[],
  history: ReceiptLine[],
  thresholdPct: number,
): VarianceRow[] {
  const byIngredient = new Map<string, ReceiptLine[]>();
  for (const h of history) {
    const list = byIngredient.get(h.ingredientId) ?? [];
    list.push(h);
    byIngredient.set(h.ingredientId, list);
  }
  for (const list of byIngredient.values())
    list.sort(
      (a, b) =>
        a.receivedAt.getTime() - b.receivedAt.getTime() ||
        a.id.localeCompare(b.id),
    );

  return window.map((l) => {
    const earlier = (byIngredient.get(l.ingredientId) ?? []).filter(
      (h) =>
        h.id !== l.id &&
        (h.receivedAt.getTime() < l.receivedAt.getTime() ||
          (h.receivedAt.getTime() === l.receivedAt.getTime() &&
            h.id.localeCompare(l.id) < 0)),
    );
    const last = earlier.length ? earlier[earlier.length - 1] : null;
    const poVar = pctChange(l.unitCost, l.poUnitCost);
    const lastVar = pctChange(l.unitCost, last?.unitCost ?? null);
    return {
      grnNumber: l.grnNumber,
      receivedAt: l.receivedAt,
      supplier: l.supplierName,
      ingredient: l.ingredientName,
      unit: l.unit,
      quantity: D(l.quantity).toString(),
      poUnitCost: l.poUnitCost == null ? null : D(l.poUnitCost).toString(),
      receivedUnitCost: D(l.unitCost).toString(),
      lastUnitCost: last ? D(last.unitCost).toString() : null,
      poVariancePct: poVar,
      lastVariancePct: lastVar,
      poVarianceAmount:
        l.poUnitCost == null
          ? null
          : D(l.unitCost)
              .minus(l.poUnitCost)
              .mul(l.quantity)
              .toDecimalPlaces(2)
              .toString(),
      flagged:
        (poVar != null && Math.abs(poVar) >= thresholdPct) ||
        (lastVar != null && Math.abs(lastVar) >= thresholdPct),
    };
  });
}

export interface InvoiceCheck {
  grnNumber: string;
  invoiceNumber: string;
  supplier: string;
  receiptTotal: string;
  invoiceTotal: string;
  difference: string;
  differencePct: number | null;
  flagged: boolean;
}

/** Receipt value (sum of quantity x price, per line rounded to cents) against the invoice recorded for it. */
export function checkInvoice(
  receipt: {
    grnNumber: string;
    supplierName: string;
    lines: { quantity: Prisma.Decimal.Value; unitCost: Prisma.Decimal.Value }[];
  },
  invoice: { invoiceNumber: string; totalAmount: Prisma.Decimal.Value },
  thresholdPct: number,
): InvoiceCheck {
  const receiptTotal = receipt.lines.reduce(
    (a, l) => a.plus(D(l.quantity).mul(l.unitCost).toDecimalPlaces(2)),
    D(0),
  );
  const diff = D(invoice.totalAmount).minus(receiptTotal);
  const pct = pctChange(invoice.totalAmount, receiptTotal);
  return {
    grnNumber: receipt.grnNumber,
    invoiceNumber: invoice.invoiceNumber,
    supplier: receipt.supplierName,
    receiptTotal: receiptTotal.toFixed(2),
    invoiceTotal: D(invoice.totalAmount).toFixed(2),
    difference: diff.toFixed(2),
    differencePct: pct,
    flagged: !diff.isZero() && (pct == null || Math.abs(pct) >= thresholdPct),
  };
}
