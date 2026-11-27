# OrderRestro 1.46.0

Server release. Update straight from 1.45.0. Three additive database migrations (menu item pause, sync review and devices, uploads backup hash); nothing existing is changed or removed.

**Kitchen and menu**
- **Pause a dish until a return time.** Menu > Pause sales > 30 minutes, or until a clock time in the restaurant's time zone. The dish stays visible with its return time; new orders and extra rounds containing it are refused by the server (also for website and kiosk orders). Bills already sent to the kitchen are unaffected, and a sale already made offline on a phone still syncs. Resume early at any time.

**Offline and server sync**
- **Fixed: sync could silently skip rows.** A backlog bigger than one page (200 up, 500 down) was paged in text order and part of it was never sent. Update both ends of a sync pair.
- **Needs review:** when two devices edit the same order, payment, refund, stock or cash record while apart, the newest edit is used and the other version is kept whole. Settings > Server sync shows it; a manager restores it or keeps the current one with a reason that is stored permanently.
- Refunds that add up to more than was paid are flagged, never merged away. A device clock more than 5 minutes ahead no longer wins every later conflict.
- **Connected devices** on the sync server: last seen, last upload, remove or allow a PC.
- The sync page now says plainly whether changes are only saved on this PC or accepted by the central server.
- Design, limits and a device test checklist: [OFFLINE-ARCHITECTURE](OFFLINE-ARCHITECTURE.md).

**Backup**
- A restore is refused if the stored database or uploads archive does not match its recorded checksum. Phone POS refuses a backup from a different branch.

**Fixed**
- Supplier invoice reader no longer uses the pre-tax subtotal as the amount due.
- Notification list "unread only = false" now shows all notifications.
- Granting a permission override honours implied permissions.

**Windows and Android**
- **Android 1.46.0 (versionCode 146000): Nearby phones.** Phones of one restaurant branch can keep a copy of each other's finished sales with no WiFi, internet or server (Sync tab > Nearby phones, Google Play services, confirm a 4-digit code on both phones). A sale is shown as "also saved on another phone", never as on the server; whichever phone syncs first uploads it and the server records it once. Not tested on real phones yet; sales only (no kitchen tickets). See [OFFLINE-ARCHITECTURE](OFFLINE-ARCHITECTURE.md).
- Windows 1.0.21.0 carries the pause and restore-check changes.

**Packages**
- Docker images and `.deb` for amd64 and arm64.
