import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, isForwardable, checkIncomingSale, saleMessage, MAX_MESSAGE_BYTES } from './nearby.js';

// A fake radio: two phones joined by a wire that can be cut and that can duplicate or reorder messages.
function radio() {
  const l = {};
  return {
    on: (e, fn) => ((l[e] ||= []).push(fn), () => {}),
    emit: (e, d) => (l[e] || []).forEach((fn) => fn(d)),
    sent: [],
    calls: [],
    start: async () => {},
    stop: async () => {},
    connect: async (a) => void 0,
    accept: async (a) => void this,
    reject: async () => {},
    disconnect: async (a) => void 0,
    send: async function (a) { this.sent.push(a); if (this.wire) this.wire(a); },
  };
}
const mem = () => {
  const m = new Map();
  return { m, get: async (id) => m.get(id), put: async (r) => void m.set(r.id, r), all: async () => [...m.values()] };
};
const sale = (id, extra = {}) => ({ id, status: 'pending', soldAt: '2026-11-27T10:00:00.000Z', items: [{ id: 'm1', name: 'Tea', qty: 1, price: 10 }], bill: { total: 10 }, payments: [{ method: 'CASH', amount: 10 }], ...extra });

function phone(name, deviceId, branchId, own = []) {
  const t = radio();
  const peerSales = mem();
  const ownStore = mem();
  own.forEach((s) => ownStore.m.set(s.id, s));
  const ackMap = {};
  const s = createSession({
    transport: t,
    peerSales,
    ownSales: ownStore,
    acks: { get: async () => ackMap, add: async (sid, d) => void (ackMap[sid] = [...new Set([...(ackMap[sid] || []), d])]) },
    me: () => ({ deviceId, name, branchId }),
  });
  return { t, s, peerSales, ownStore, ackMap, name };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

// Wires A's endpoint 'b' to B's endpoint 'a', runs the code check, then delivers messages.
async function pair(A, B, { confirm = true, cut = false } = {}) {
  A.t.wire = cut ? () => {} : (m) => setImmediate(() => B.t.emit('payload', { id: 'a', text: m.text }));
  B.t.wire = (m) => setImmediate(() => A.t.emit('payload', { id: 'b', text: m.text }));
  A.t.emit('peerFound', { id: 'b', name: B.name });
  A.t.emit('connectionRequest', { id: 'b', name: B.name, code: '4821', incoming: false });
  B.t.emit('connectionRequest', { id: 'a', name: A.name, code: '4821', incoming: true });
  if (!confirm) return;
  A.t.emit('connectionResult', { id: 'b', ok: true });
  B.t.emit('connectionResult', { id: 'a', ok: true });
  await settle();
}

test('a final sale reaches the other phone, is stored apart, and is acked only after it is on disk', async () => {
  const A = phone('Waiter', 'dev-aaaa', 'branch1', [sale('sale-0001')]);
  const B = phone('Counter', 'dev-bbbb', 'branch1');
  await pair(A, B);
  await settle();
  assert.equal(B.peerSales.m.get('sale-0001').status, 'held');
  assert.equal(B.peerSales.m.get('sale-0001').from.deviceId, 'dev-aaaa');
  assert.equal(B.ownStore.m.size, 0, 'never enters the receiving phone\'s own sales');
  assert.deepEqual(A.ackMap['sale-0001'], ['dev-bbbb']);
});

test('the same sale delivered again is acked but not written twice', async () => {
  const A = phone('Waiter', 'dev-aaaa', 'branch1', [sale('sale-0002')]);
  const B = phone('Counter', 'dev-bbbb', 'branch1');
  await pair(A, B);
  await settle();
  const first = B.peerSales.m.get('sale-0002');
  const msg = JSON.stringify({ t: 'sale', v: 1, sale: sale('sale-0002', { bill: { total: 999 } }) });
  B.t.emit('payload', { id: 'a', text: msg });
  B.t.emit('payload', { id: 'a', text: msg });
  await settle();
  assert.equal(B.peerSales.m.size, 1);
  assert.equal(B.peerSales.m.get('sale-0002'), first, 'the stored copy is not overwritten');
});

test('nothing is sent or accepted before the code is confirmed', async () => {
  const A = phone('Waiter', 'dev-aaaa', 'branch1', [sale('sale-0003')]);
  const B = phone('Counter', 'dev-bbbb', 'branch1');
  await pair(A, B, { confirm: false });
  B.t.emit('payload', { id: 'a', text: JSON.stringify({ t: 'sale', v: 1, sale: sale('sale-0003') }) });
  await settle();
  assert.equal(B.peerSales.m.size, 0);
  assert.equal(A.t.sent.length, 0);
  assert.equal(A.s.peers()[0].state, 'verify');
  assert.equal(A.s.peers()[0].code, '4821');
});

test('a phone from another branch is disconnected and gets nothing', async () => {
  const A = phone('Waiter', 'dev-aaaa', 'branch1', [sale('sale-0004')]);
  const B = phone('Other', 'dev-cccc', 'branch2');
  const gone = [];
  A.t.disconnect = async (a) => void gone.push(a.id);
  await pair(A, B);
  await settle();
  assert.equal(B.peerSales.m.size, 0);
  assert.equal(A.s.peers()[0].state, 'refused');
  assert.deepEqual(gone, ['b']);
});

test('phone-only accounts (branch "local") never pair, even with each other', async () => {
  const A = phone('One', 'dev-aaaa', 'local', [sale('sale-0005')]);
  const B = phone('Two', 'dev-bbbb', 'local');
  await pair(A, B);
  await settle();
  assert.equal(B.peerSales.m.size, 0);
});

test('only final, not-yet-synced sales travel', () => {
  assert.equal(isForwardable(sale('s1xxxxxx')), true);
  assert.equal(isForwardable(sale('s2xxxxxx', { status: 'synced' })), false);
  assert.equal(isForwardable(sale('s3xxxxxx', { status: 'refused' })), false);
  assert.equal(isForwardable(sale('s4xxxxxx', { payLater: true })), false);
  assert.equal(isForwardable(sale('s5xxxxxx', { collections: [{ id: 'c' }] })), false);
});

test('malformed and hostile sales are rejected', () => {
  for (const bad of [null, 5, {}, sale('short'), sale('x'.repeat(130)), { ...sale('okokokok'), items: [] }, { ...sale('okokokok'), bill: { total: -1 } },
    { ...sale('okokokok'), bill: { total: NaN } }, { ...sale('okokokok'), soldAt: 'nope' }, { ...sale('okokokok'), payments: 'x' }, sale('okokokok', { payLater: true })])
    assert.equal(typeof checkIncomingSale(bad), 'string');
  const ok = checkIncomingSale({ ...sale('okokokok'), status: 'synced', serverOrderId: 'x', refusedReason: 'y' });
  assert.equal(ok.status, 'pending');
  assert.equal(ok.serverOrderId, undefined);
});

test('oversized messages, garbage and unknown types are ignored without harm', async () => {
  const A = phone('Waiter', 'dev-aaaa', 'branch1');
  const B = phone('Counter', 'dev-bbbb', 'branch1');
  await pair(A, B);
  await settle();
  for (const text of ['not json', '{"t":"sale","v":2}', '{"t":"drop","v":1}', 'x'.repeat(MAX_MESSAGE_BYTES + 1), JSON.stringify({ t: 'ack', v: 1, id: 'never-sent' })])
    B.t.emit('payload', { id: 'a', text });
  await settle();
  assert.equal(B.peerSales.m.size, 0);
  assert.deepEqual(A.ackMap, {});
  assert.equal(saleMessage(sale('big-sale-1', { note: 'x'.repeat(MAX_MESSAGE_BYTES) })), null);
});

test('a cut connection before the ack leaves the sale unacknowledged, and it goes again next time', async () => {
  const A = phone('Waiter', 'dev-aaaa', 'branch1', [sale('sale-0006')]);
  const B = phone('Counter', 'dev-bbbb', 'branch1');
  await pair(A, B, { cut: true }); // the wire drops A's messages: B never receives the sale
  assert.deepEqual(A.ackMap, {}, 'no ack, so not shown as held elsewhere');
  A.t.emit('disconnected', { id: 'b' });
  // reconnect with a working wire
  await pair(A, B);
  await settle();
  assert.equal(B.peerSales.m.get('sale-0006').status, 'held');
  assert.deepEqual(A.ackMap['sale-0006'], ['dev-bbbb']);
});
