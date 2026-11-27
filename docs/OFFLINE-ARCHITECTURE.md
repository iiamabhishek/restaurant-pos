# Offline operation and device sync

Status: first production slice (Phase 1 + part of Phase 2). Read the "Not built" list before promising anything to a customer.

## 1. What already existed (assessed 2026-11-27)

| Layer | Mechanism | Offline behaviour |
|---|---|---|
| Phones and tablets on the restaurant WiFi | App opens the restaurant computer's web app (`http://<pc>:1995`) | Works with **no internet** as long as the WiFi router and the PC are up. This is the local-server tier. |
| Web/phone app, server unreachable | `apps/web/lib/outbox.ts` queue for kitchen/delivery status changes | Saved on the phone, retried with back-off, refused ones are listed. Money is never queued here. |
| Phone POS (`mobile/www/pos`) | IndexedDB journal, sales carry their own id | Sells with no server at all; "Waiting to sync / Synced / Refused". Menu pauses (PR #135) never block an already-made offline sale. |
| Restaurant PC to central server | `apps/backend/src/sync`: DB triggers log every row change, pull/push over HTTPS with a shared key | Each PC keeps working offline and catches up. Conflict rule: whole-row last-writer-wins by change time. |

A second ordering/sync system was deliberately **not** added. This work hardens the existing server sync and exposes it honestly to staff.

## 2. Topology and what each failure means

```
 phones / KDS / counters ──WiFi LAN──▶ restaurant PC (local server, has its own Postgres) ──internet──▶ central server
```

| What is down | What still works | What staff are told |
|---|---|---|
| Internet only | Everything on the LAN: billing, kitchen, phones. Changes queue on the PC. | PC sync page: **Working offline**, N changes saved here, not on the server. |
| Restaurant PC / router | Phone POS sells alone and queues sales; the web app shows its offline banner. Server-linked screens cannot take new orders. | Phone banner; phone POS "Waiting to sync". |
| Central server | Same as internet down. | Same. |
| Everything | Each phone POS works alone. | "Saved on this device". |

"Synced" is shown **only** when the central server has accepted everything from this PC, nothing is waiting and no conflict is open (`SyncService.stateOf`, unit tested). A peer or the LAN server acknowledging something is never shown as the central server accepting it.

## 3. Sync protocol (restaurant PC <-> central server)

- Change capture: triggers write `sync_changes` (table, primary key, op, whole row, timestamp, origin) in the **same transaction** as the business write.
- Cycle: pull (cursor `lastPullSeq`, pages of 500) then push (cursor `lastPushSeq`, pages of 200). A cursor moves only after the receiver committed the page. Retries resend from the cursor; applying a change twice is harmless (same row, same timestamp, identical content is a no-op and records nothing).
- **Fixed in this release:** both queries paged with `ORDER BY seq` while selecting `seq::text`; Postgres sorted by the text column (`1, 10, 100…`) so any backlog over one page silently skipped rows forever. Regression tests: interrupted 450-row batch and 700-row pull.
- Payloads: validated shape, at most 2000 changes, device id format checked, unknown tables rejected (cannot be used for SQL).
- Devices: `sync_peers` records each device's last pull/push. An owner can remove a device (HTTP 403 `PEER_REVOKED`, the PC says so) and allow it again. Removal only stops future syncing; it cannot wipe a lost PC.
- Clock skew: a change stamped more than 5 minutes ahead is stamped with the receiver's time (fixed per change, so retries cannot re-win) and logged as `CLOCK_SKEW`. A clock that is *behind* cannot be detected; its edits lose conflicts but are kept (below).

## 4. Conflict rules per domain

Insert-only rows with unique ids (a new order, a new payment, a new refund) never collide: **both devices' records are kept**. Order numbers are per branch/day and a device offline for a day can produce numbers another device also used; check local invoice-numbering rules before relying on them as legal numbers.

For concurrent edits of the **same row** the newest change is applied (unchanged behaviour), but for business-critical tables (orders and lines, payments, refunds, gateway payments/refunds, shifts, cash closings, petty cash, stock movements/levels/counts/journals, supplier payments, loyalty points) the **losing version is stored whole** in `sync_conflicts` and shown under Settings > Server sync > "Needs review":

| Case | Kind | Manager choices |
|---|---|---|
| Incoming change lost to a newer local one | `SUPERSEDED_INCOMING` | Use the saved version (re-applied as a new change that wins and syncs everywhere) or keep the current one |
| Server's newer version replaced an unsent local edit | `OVERWRITTEN_LOCAL` | same; the stale local edit is removed from the outgoing queue so it is recorded once |
| Refunds on an order exceed payments | `EXCESS_REFUND` | Acknowledge only. Both refunds stay; sync never executes or hides a refund, and it never moves money. |
| Device clock ahead | `CLOCK_SKEW` | auto-resolved, informational |

Every decision requires a reason and is stored on the row (who, when, why); resolved rows cannot be edited or deleted (DB trigger) and the action is also written to the audit log.

Domain notes and **limits**:
- Payments: card/UPI/gateway money is never reported as received because something was queued; gateway state stays with the gateway (`NEEDS_REVIEW` on uncertain results, existing behaviour).
- Refunds: the local record is a record, not proof money moved. Excess refunds are flagged after the fact; sync does not block them. Preventing them while two devices are apart is not possible without a lock holder.
- Inventory: `stock_levels` is an absolute number, so two devices deducting at once keep one deduction in the level; the other is preserved in the conflict journal and in stock movements. **Stock can be wrong until reviewed**; overselling while isolated is possible.
- Kitchen status: the server rejects stale moves (409) for server-linked screens; the sync layer does not add a state machine.
- Menu/price/tax: whole-row newest wins; a completed order keeps its own line prices.
- Whole-row granularity: two different fields edited on the same row on two devices are *not* merged; the loser is kept in review, not combined.

## 5. Phone-to-phone (Nearby) — built in Android 1.46.0, not yet tested on real phones

Sync tab > **Nearby phones** (Android app, phones linked to the same server branch). `NearbyPlugin.java` wraps Google's Nearby Connections (P2P_CLUSTER; Bluetooth/Wi-Fi Direct chosen by Play services); `www/pos/lib/nearby.js` is the protocol; `nearby.test.mjs` runs it against a fake radio (cut wire, duplicates, hostile messages).

- **What travels:** each *final* sale not yet on the server (no pay-later, no part-collected sales) goes to a nearby phone as a copy keyed by its sale id. The receiver writes it to its own disk (store `peerSales`, never mixed into its own sales, till, numbering or reports), then acks. The sender shows "also saved on another phone", never "on the server". Either phone uploads it on the next sync; the server records it once by sale id (`duplicate` counts as done). This gives a sale a second durable copy when a phone is lost before it can sync.
- **Pairing:** both phones show the same 4-digit code (Nearby's authentication digits); nothing is accepted or sent until a person taps "same code" on each. Phone-only accounts (`branch = local`) never pair; a phone from another branch is disconnected at hello.
- **Limits:** Android with Google Play services only (no iOS, no de-Googled phones, no browser); about 100 m in the open; both phones keep the screen open on the Sync tab (no background service); one message is at most 30 KB; 500 sales per session per direction; kitchen tickets, orders, refunds and collections do **not** travel yet.
- **Permissions:** Nearby devices (Android 12+ / 13+) or location (Android 11 and older). Adds the `play-services-nearby` dependency (Google Play services terms).
- **Verified:** native code compiles, the app starts on an Android 14 emulator and registers the plugin, protocol tests pass. **Not verified:** any real phone-to-phone connection, range, battery, Bluetooth-only vs Wi-Fi Direct behaviour, or Play review of the new permissions. An emulator has no radios. Use the checklist below before telling customers it works.
- **Manual check (two real Android phones, same branch, linked to a server):** (1) both open Sync > Look for nearby phones; (2) connect, confirm the code on both; (3) make a cash sale on A with the server unreachable; (4) B shows "held for other phones: 1"; (5) A shows "also saved on another phone"; (6) restore the connection and Sync now on B only: the sale appears on the server once; (7) Sync now on A: no duplicate; (8) move 100 m apart and confirm it drops cleanly; (9) try a phone from another branch.

## 5b. Other transports (research notes)

- **Baseline (built):** WiFi router/hotspot without internet + PC as local server + durable DB. Works on Android, iOS, desktop and browsers.
- **Android Nearby Connections** (Google Play services, Android only, roughly 100 m, strategies cluster/star/point-to-point; documented throughput varies by strategy and device, an independent 2023 study found star unstable): used above with the cluster strategy. Cannot talk to iOS.
- **Apple:** local-network privacy prompt since iOS 14; Apple engineers steer new work from Multipeer Connectivity to Network framework with peer-to-peer WiFi. Android and Apple native peer links do not interoperate; cross-platform therefore means LAN/hotspot.
- **Browser/PWA:** no Wi-Fi Direct or background networking; LAN only.
- **Not claimed:** no multi-hop mesh, no automatic failover leader election (two leaders would corrupt data), no phone acting as the server (OS can suspend it).
- Third-party sync products were not adopted: they would add a proprietary or hosted dependency for little over the existing trigger log.

## 6. Security

Sync key is a shared secret compared in constant time; stored sealed at rest; the sync endpoints reject malformed payloads, are size-limited per request, and answer 403 to removed devices. Transport security depends on the server URL being HTTPS (the settings page does not force it; use HTTPS for any non-LAN server). Replicated data includes customer names/phones as the business tables do; there is no per-field minimisation. Single-tenant installs: cross-tenant isolation is not applicable to this protocol (one restaurant per install); not tested. Offline login expiry/revocation of staff accounts is unchanged and follows the normal session rules.

## 7. Tests

`apps/backend/test/sync-offline.e2e-spec.ts` (`SYNC_OFFLINE_E2E=1`, needs a Postgres user that can create databases): two real databases, real HTTP between them, injected outage and dropped connection. Covers: first adopt, server unreachable then converge with both sides creating orders, concurrent edit + restore + immutability, unsent local edit replaced, double refund, repeated delivery, clock a day ahead (including replay), removed device, malformed/oversized/injection payloads, dropped connection mid-batch, 700-row pull paging. Unit tests: state wording and payload validation.

**No real phones, tablets or Windows PCs were used.** Nothing here proves Nearby/Wi-Fi Direct (not built) or the phone apps on hardware. Manual checklist before a pilot: (1) PC+router with internet cable pulled: phones still bill; (2) unplug the PC: phone POS keeps selling, reconnect, sales arrive once; (3) two PCs, edit the same order apart, reconnect, confirm Needs review shows the loser; (4) set one PC's clock +1 day; (5) remove a PC in Connected devices, confirm it reports removal; (6) kill the PC process mid-sync, restart, counts equal.

## 8. Rollout and rollback

New migration `20261127010000_sync_conflicts_peers` is additive (two new tables, one trigger function). Both ends of a sync pair should run the same version (the schema check already enforces equal migrations). Rollback: deploy the previous image; the two tables are ignored (names start with `sync_`, never synced). Take a backup first (Settings > Backup). Nothing is enabled by default: installs that do not use server sync are unaffected.

## 9. Not built

Per-device roles on the sync layer (existing staff roles still apply to screens), local-network discovery/QR pairing for the PC-to-PC link, Nearby for kitchen tickets/orders (sales only today) and any iOS or desktop peer link, kitchen-ticket acknowledgement states ("saved locally" vs "kitchen has it") beyond the existing 409 rules, an operation-level event log with per-field merge, sale-number reservation per device, and any real-device pilot.
