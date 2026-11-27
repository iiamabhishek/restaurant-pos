// Phone-to-phone hand-off of sales over Nearby Connections (no router, internet or server).
//
// What it is: a durable second copy. A phone sends each of its final sales that the server does not have yet to a
// nearby phone of the SAME restaurant branch. The receiver writes it to its own disk, then says "ack". The sender
// shows that as "also held by <phone>", never as "on the server". Either phone later uploads the sale; the server
// matches it by sale id, so it is recorded once however many phones send it.
//
// What it is not: a way to keep two till drawers or two number sequences in step. Received sales are stored apart
// (store `peerSales`) and never enter the receiving phone's own sales list, till, numbering or reports.
//
// Safety rules, all enforced here and covered by nearby.test.mjs:
//  - nothing is sent or accepted until a person confirmed the same 4-digit code on both phones;
//  - both phones must be linked to the same server branch (a phone-only account never pairs);
//  - a sale is acked only after it is on disk; a sale already known is acked again but not rewritten;
//  - only final sales travel (not pay-later or part-collected ones: their later payments belong to one phone);
//  - messages are size-limited, shape-checked and capped per session; unknown message types are ignored.

export const PROTOCOL = 1;
export const MAX_MESSAGE_BYTES = 30000; // Nearby's limit for one bytes payload is 32 KB
export const MAX_SALES_PER_SESSION = 500;
const MAX_ITEMS = 200;

const byteLength = (s) => new TextEncoder().encode(s).length;

/** A sale that is complete on this phone and not yet on the server. */
export function isForwardable(sale) {
  if (!sale || typeof sale !== 'object') return false;
  if (sale.status !== 'pending') return false; // synced, refused and set-aside sales stay where they are
  if (sale.payLater) return false;
  if (Array.isArray(sale.collections) && sale.collections.length) return false;
  return true;
}

/** The message for one sale, or null if it cannot travel (too large). */
export function saleMessage(sale) {
  const text = JSON.stringify({ t: 'sale', v: PROTOCOL, sale });
  return byteLength(text) <= MAX_MESSAGE_BYTES ? text : null;
}

/**
 * Check a sale that arrived from another phone. Returns the sale to store, or a string saying why not.
 * Only the shape is checked here; the server applies the real business rules when the sale is uploaded and
 * refuses what it does not accept, which the phone then shows.
 */
export function checkIncomingSale(sale) {
  if (!sale || typeof sale !== 'object') return 'not a sale';
  if (typeof sale.id !== 'string' || sale.id.length < 8 || sale.id.length > 120) return 'bad id';
  if (!Array.isArray(sale.items) || sale.items.length === 0 || sale.items.length > MAX_ITEMS) return 'bad items';
  if (!sale.bill || typeof sale.bill.total !== 'number' || !Number.isFinite(sale.bill.total) || sale.bill.total < 0) return 'bad total';
  if (typeof sale.soldAt !== 'string' || Number.isNaN(Date.parse(sale.soldAt))) return 'bad date';
  if (!Array.isArray(sale.payments)) return 'bad payments';
  if (sale.payLater || (Array.isArray(sale.collections) && sale.collections.length)) return 'not a final sale';
  // The sender's own bookkeeping fields mean nothing here.
  const clean = { ...sale, status: 'pending' };
  for (const k of ['serverOrderId', 'serverOrderNumber', 'syncedAt', 'refusedReason', 'refusedCode', 'review', 'syncPayloadCollections']) delete clean[k];
  return clean;
}

/**
 * One Nearby session. Everything outside the radio is injected, so it runs the same in the app and in tests.
 *   transport  { start, stop, connect, accept, reject, disconnect, send, on(event, fn) } (NearbyPlugin)
 *   peerSales  { get(id), put(row), all() }          sales held for other phones
 *   ownSales   { all() , get(id) }                    this phone's own sales
 *   acks       { get() -> {saleId:[deviceId]}, add(saleId, deviceId) }
 *   me         () -> { deviceId, name, branchId }
 */
export function createSession({ transport, peerSales, ownSales, acks, me, now = () => new Date(), onChange = () => {} }) {
  const peers = new Map(); // endpoint id -> { id, name, state, code, deviceId, sent:Set, inflight:Set, received:number }
  const log = [];
  const note = (text) => {
    log.unshift({ at: now().toISOString(), text });
    log.length = Math.min(log.length, 30);
  };
  const upd = (id, patch) => {
    const p = peers.get(id) || { id, name: '?', state: 'found', sent: new Set(), inflight: new Set(), received: 0 };
    Object.assign(p, patch);
    peers.set(id, p);
    onChange();
    return p;
  };
  const sendJson = (id, obj) => transport.send({ id, text: JSON.stringify(obj) });

  async function hello(id) {
    const m = me();
    await sendJson(id, { t: 'hello', v: PROTOCOL, deviceId: m.deviceId, name: m.name, branchId: m.branchId });
  }

  async function pump(id) {
    const p = peers.get(id);
    if (!p || p.state !== 'ready') return;
    const known = await acks.get();
    for (const sale of await ownSales.all()) {
      if (p.sent.size >= MAX_SALES_PER_SESSION) break;
      if (!isForwardable(sale)) continue;
      if ((known[sale.id] || []).includes(p.deviceId) || p.inflight.has(sale.id) || p.sent.has(sale.id)) continue;
      const text = saleMessage(sale);
      if (!text) {
        note(`A sale was too large to send to ${p.name} and stays on this phone.`);
        p.sent.add(sale.id);
        continue;
      }
      p.inflight.add(sale.id);
      try {
        await transport.send({ id, text });
      } catch (e) {
        p.inflight.delete(sale.id);
        note(`Could not send to ${p.name}: ${e && e.message ? e.message : e}`);
        break;
      }
    }
  }

  async function onPayload({ id, text }) {
    const p = peers.get(id);
    if (!p || (p.state !== 'connected' && p.state !== 'ready')) return; // nothing is trusted before the code check
    if (typeof text !== 'string' || byteLength(text) > MAX_MESSAGE_BYTES) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || msg.v !== PROTOCOL) return;
    if (msg.t === 'hello') {
      const m = me();
      if (typeof msg.deviceId !== 'string' || msg.deviceId.length < 4 || msg.deviceId.length > 120) return;
      if (!m.branchId || m.branchId === 'local' || msg.branchId !== m.branchId) {
        note(`${p.name} belongs to a different restaurant branch, so it was disconnected.`);
        await sendJson(id, { t: 'bye', v: PROTOCOL, reason: 'branch' }).catch(() => {});
        upd(id, { state: 'refused' });
        transport.disconnect({ id });
        return;
      }
      upd(id, { state: 'ready', deviceId: msg.deviceId, name: String(msg.name || p.name).slice(0, 40) });
      await pump(id);
    } else if (p.state !== 'ready') {
      return; // anything else waits for hello
    } else if (msg.t === 'sale') {
      if (p.received >= MAX_SALES_PER_SESSION) return;
      const clean = checkIncomingSale(msg.sale);
      if (typeof clean === 'string') {
        note(`Ignored a sale from ${p.name}: ${clean}.`);
        return;
      }
      p.received++;
      const have = (await peerSales.get(clean.id)) || (await ownSales.get(clean.id));
      if (!have) {
        // On disk first, then acknowledged.
        await peerSales.put({ id: clean.id, sale: clean, from: { deviceId: p.deviceId, name: p.name }, receivedAt: now().toISOString(), status: 'held' });
        note(`Received a sale from ${p.name}.`);
      }
      await sendJson(id, { t: 'ack', v: PROTOCOL, id: clean.id });
      onChange();
    } else if (msg.t === 'ack') {
      if (typeof msg.id === 'string' && p.inflight.has(msg.id)) {
        p.inflight.delete(msg.id);
        p.sent.add(msg.id);
        await acks.add(msg.id, p.deviceId);
        onChange();
      }
    } else if (msg.t === 'bye') {
      transport.disconnect({ id });
    }
  }

  const offs = [
    transport.on('peerFound', ({ id, name }) => {
      if (!peers.has(id) || peers.get(id).state === 'found') upd(id, { name: String(name || '?').slice(0, 40), state: 'found' });
    }),
    transport.on('peerLost', ({ id }) => {
      const p = peers.get(id);
      if (p && p.state === 'found') {
        peers.delete(id);
        onChange();
      }
    }),
    transport.on('connectionRequest', ({ id, name, code, incoming }) => {
      upd(id, { name: String(name || '?').slice(0, 40), state: 'verify', code: String(code || ''), incoming: !!incoming });
    }),
    transport.on('connectionResult', ({ id, ok, rejected }) => {
      if (ok) {
        upd(id, { state: 'connected' });
        hello(id).catch((e) => note(`Hello failed: ${e && e.message ? e.message : e}`));
      } else {
        note(rejected ? 'The other phone refused the connection.' : 'Could not connect.');
        upd(id, { state: 'found', code: '' });
      }
    }),
    transport.on('disconnected', ({ id }) => {
      const p = peers.get(id);
      if (p) {
        note(`${p.name} disconnected.`);
        // Sales sent but never acked simply go again next time; an ack is the only thing that counts.
        peers.delete(id);
        onChange();
      }
    }),
    transport.on('payload', (e) => {
      onPayload(e).catch((err) => note(`Problem handling a message: ${err && err.message ? err.message : err}`));
    }),
  ];

  return {
    peers: () => [...peers.values()].map((p) => ({ id: p.id, name: p.name, state: p.state, code: p.code, deviceId: p.deviceId, sent: p.sent.size, inflight: p.inflight.size, received: p.received })),
    log: () => [...log],
    start: () => transport.start({ name: me().name }),
    stop: async () => {
      await transport.stop();
      peers.clear();
      onChange();
    },
    connect: (id) => transport.connect({ id }),
    /** The person confirmed the code matches on both phones. */
    confirm: (id) => transport.accept({ id }),
    deny: (id) => {
      transport.reject({ id });
      peers.delete(id);
      onChange();
    },
    /** Look for sales that appeared since the last pass (called on a timer while the screen is open). */
    tick: async () => {
      for (const p of peers.values()) await pump(p.id);
    },
    dispose: () => offs.forEach((o) => o && o()),
  };
}
