import { SyncChange, SyncService } from './sync.service';

const ch = (
  pkKey: string,
  ts: string,
  op: 'U' | 'D' = 'U',
  tbl = 'menu_items',
): SyncChange => ({
  tbl,
  pk: { id: pkKey },
  pkKey,
  op,
  row: op === 'U' ? { id: pkKey } : null,
  ts,
});

describe('SyncService.compact', () => {
  it('keeps only the newest change per row', () => {
    const out = SyncService.compact([
      ch('a', '2026-01-01T00:00:00.000Z'),
      ch('a', '2026-01-01T00:00:02.000Z', 'D'),
      ch('a', '2026-01-01T00:00:01.000Z'),
      ch('b', '2026-01-01T00:00:00.000Z'),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.pkKey === 'a')?.op).toBe('D');
  });

  it('treats the same key in different tables as different rows', () => {
    const out = SyncService.compact([
      ch('a', '2026-01-01T00:00:00.000Z', 'U', 'orders'),
      ch('a', '2026-01-01T00:00:00.000Z', 'U', 'tables'),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('SyncService.stateOf (what staff are told)', () => {
  const now = Date.parse('2026-11-27T10:00:00Z');
  const fresh = new Date('2026-11-27T09:59:30Z');
  const base = {
    enabled: true,
    role: 'client',
    lastSyncAt: fresh,
    lastError: null,
  };

  it('says synced only when the server has everything and nothing is disputed', () => {
    expect(SyncService.stateOf(base, 0, 0, now)).toBe('synced');
  });
  it('never says synced while changes are only saved on this device', () => {
    expect(SyncService.stateOf(base, 3, 0, now)).toBe('pending');
  });
  it('flags open conflicts even when nothing is waiting', () => {
    expect(SyncService.stateOf(base, 0, 2, now)).toBe('conflict');
  });
  it('is offline after an error or when the last good sync is old, even with nothing pending', () => {
    expect(SyncService.stateOf({ ...base, lastError: 'x' }, 0, 0, now)).toBe(
      'offline',
    );
    expect(
      SyncService.stateOf(
        { ...base, lastSyncAt: new Date('2026-11-27T09:00:00Z') },
        0,
        0,
        now,
      ),
    ).toBe('offline');
    expect(SyncService.stateOf({ ...base, lastSyncAt: null }, 0, 0, now)).toBe(
      'offline',
    );
  });
  it('reports off and server roles', () => {
    expect(SyncService.stateOf({ ...base, enabled: false }, 0, 0, now)).toBe(
      'off',
    );
    expect(SyncService.stateOf({ ...base, role: 'server' }, 0, 0, now)).toBe(
      'server',
    );
  });
});

describe('SyncService.validate', () => {
  const good = {
    tbl: 'orders',
    pk: { id: '1' },
    pkKey: '{"id":"1"}',
    op: 'U',
    row: { id: '1' },
    ts: '2026-11-27T10:00:00Z',
  };
  it('accepts a well-formed update and delete', () => {
    expect(
      SyncService.validate([good, { ...good, op: 'D', row: null }]),
    ).toHaveLength(2);
  });
  it.each([
    ['not a list', 'x'],
    ['missing table', [{ ...good, tbl: undefined }]],
    ['bad op', [{ ...good, op: 'X' }]],
    ['bad timestamp', [{ ...good, ts: 'yesterday' }]],
    ['update without a row', [{ ...good, row: null }]],
    ['delete carrying a row', [{ ...good, op: 'D' }]],
    ['null entry', [null]],
    ['oversized batch', new Array(2001).fill(good)],
  ])('rejects %s', (_n, input) => {
    expect(() => SyncService.validate(input)).toThrow();
  });
});
