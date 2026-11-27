import {
  checkInvoice,
  computeVariance,
  pctChange,
  type ReceiptLine,
} from './price-variance';

const line = (
  o: Partial<ReceiptLine> & { id: string; day: number },
): ReceiptLine => ({
  grnNumber: `GRN-${o.id}`,
  receivedAt: new Date(Date.UTC(2026, 10, o.day)),
  supplierName: 'Fresh Co',
  ingredientId: 'rice',
  ingredientName: 'Rice',
  unit: 'KG',
  quantity: 10,
  unitCost: 50,
  poUnitCost: null,
  ...o,
});

describe('price variance', () => {
  it('compares to the order price and to the last price paid for the same item', () => {
    const history = [
      line({ id: 'a', day: 1, unitCost: 50 }),
      line({ id: 'b', day: 5, unitCost: 52 }),
      line({ id: 'c', day: 9, unitCost: 60, poUnitCost: 52 }),
    ];
    const [row] = computeVariance([history[2]], history, 5);
    expect(row.lastUnitCost).toBe('52'); // the receipt before it, not the first one
    expect(row.lastVariancePct).toBe(15.4);
    expect(row.poVariancePct).toBe(15.4);
    expect(row.poVarianceAmount).toBe('80'); // 8 more per kg x 10 kg
    expect(row.flagged).toBe(true);
  });

  it('the first purchase of an item has no last price and is not flagged for it', () => {
    const only = [line({ id: 'a', day: 3 })];
    const [row] = computeVariance(only, only, 5);
    expect(row.lastUnitCost).toBeNull();
    expect(row.lastVariancePct).toBeNull();
    expect(row.flagged).toBe(false);
  });

  it('does not use another item or a later receipt as the last price', () => {
    const history = [
      line({ id: 'a', day: 2, ingredientId: 'oil', unitCost: 999 }),
      line({ id: 'b', day: 4, unitCost: 50 }),
      line({ id: 'c', day: 8, unitCost: 80 }),
    ];
    const [row] = computeVariance([history[1]], history, 5);
    expect(row.lastUnitCost).toBeNull();
  });

  it('small moves under the threshold are not flagged', () => {
    const history = [
      line({ id: 'a', day: 1, unitCost: 100 }),
      line({ id: 'b', day: 2, unitCost: 102 }),
    ];
    expect(computeVariance([history[1]], history, 5)[0].flagged).toBe(false);
  });

  it('a zero or missing base never divides by zero', () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(10, null)).toBeNull();
  });

  it('exact decimals: 0.1 + 0.2 style sums do not drift', () => {
    const c = checkInvoice(
      {
        grnNumber: 'G1',
        supplierName: 'S',
        lines: [
          { quantity: 3, unitCost: 0.1 },
          { quantity: 3, unitCost: 0.2 },
        ],
      },
      { invoiceNumber: 'I1', totalAmount: 0.9 },
      5,
    );
    expect(c.receiptTotal).toBe('0.90');
    expect(c.difference).toBe('0.00');
    expect(c.flagged).toBe(false);
  });

  it('flags an invoice that bills more than was received', () => {
    const c = checkInvoice(
      {
        grnNumber: 'G2',
        supplierName: 'S',
        lines: [{ quantity: 10, unitCost: 50 }],
      },
      { invoiceNumber: 'I2', totalAmount: 560 },
      5,
    );
    expect(c.difference).toBe('60.00');
    expect(c.differencePct).toBe(12);
    expect(c.flagged).toBe(true);
  });
});
