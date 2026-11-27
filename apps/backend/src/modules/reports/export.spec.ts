import { renderReport } from './export';
import type { ReportResult } from './reports.service';

const report: ReportResult = {
  key: 'sales-daily',
  title: 'Daily sales',
  columns: ['Date', 'Orders', 'Sales'],
  rows: [
    ['2026-11-01', 2, 100],
    ['2026-11-02', 1, 50],
  ],
  totals: ['Total', 3, 150],
};

describe('report export totals', () => {
  it('adds the totals line to CSV', async () => {
    const csv = (await renderReport(report, 'csv', 'x')).toString('utf8');
    expect(csv.trimEnd().split('\r\n').pop()).toBe('Total,3,150');
  });

  it('renders xlsx and pdf with totals without throwing', async () => {
    expect((await renderReport(report, 'xlsx', 'x')).length).toBeGreaterThan(0);
    const pdf = await renderReport(report, 'pdf', 'x');
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('keeps every row when a PDF spans several pages', async () => {
    const many: ReportResult = {
      ...report,
      rows: Array.from({ length: 200 }, (_, i) => [`d${i}`, 1, i]),
    };
    expect((await renderReport(many, 'pdf', 'x')).length).toBeGreaterThan(1000);
  });
});
