import { Prisma } from '@prisma/client';
import { imbalances, salesVoucher, toRows, twoLine } from './journal';

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);

describe('accounting journal', () => {
  it('a sales voucher balances and Sales is net of tax, tips and delivery', () => {
    const lines = salesVoucher({
      date: '2026-11-01',
      byMethod: new Map([
        ['CASH', D(100.1)],
        ['UPI', D(200.2)],
      ]),
      tax: D(14.3),
      tips: D(10),
      delivery: D(5),
      orders: 4,
    });
    expect(imbalances(lines).size).toBe(0);
    expect(lines.find((l) => l.account === 'Sales')?.credit.toFixed(2)).toBe(
      '271.00',
    );
    expect(
      lines.find((l) => l.account === 'Cash in hand')?.debit.toFixed(2),
    ).toBe('100.10');
  });

  it('exact decimals: 0.1 + 0.2 does not leave a stray cent', () => {
    const lines = salesVoucher({
      date: '2026-11-02',
      byMethod: new Map([
        ['CASH', D(0.1)],
        ['CARD', D(0.2)],
      ]),
      tax: D(0),
      tips: D(0),
      delivery: D(0),
      orders: 1,
    });
    expect(imbalances(lines).size).toBe(0);
    expect(lines.find((l) => l.account === 'Sales')?.credit.toFixed(2)).toBe(
      '0.30',
    );
  });

  it('two-line vouchers balance and a broken voucher is detected', () => {
    const ok = twoLine(
      '2026-11-03',
      'Purchase',
      'INV-1',
      'Purchases',
      'Supplier: Fresh Co',
      99.99,
      'x',
    );
    expect(imbalances(ok).size).toBe(0);
    const broken = [...ok];
    broken[1] = { ...broken[1], credit: D(99.98) };
    expect(imbalances(broken).get('Purchase|INV-1')?.toFixed(2)).toBe('0.01');
  });

  it('rows are in date order and zero sides are left blank', () => {
    const rows = toRows([
      ...twoLine('2026-11-05', 'Expense', 'E1', 'Rent', 'Cash in hand', 50, ''),
      ...twoLine('2026-11-01', 'Expense', 'E0', 'Tea', 'Cash in hand', 5, ''),
    ]);
    expect(rows[0][0]).toBe('2026-11-01');
    expect(rows[0][4]).toBe('5.00');
    expect(rows[0][5]).toBe('');
  });
});
