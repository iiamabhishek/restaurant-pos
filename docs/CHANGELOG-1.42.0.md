# OrderRestro 1.42.0

**New**
- **Customer dues.** Customers → Customer dues lists every open bill with a named customer: what is owed, what was paid, the payment history, with filters for status, customer and date. Record a later payment against a specific bill, or open a prefilled WhatsApp reminder for staff to review and send. See `docs/CUSTOMER-DUES.md`.
- **Guest bill QR.** Show a guest a QR for their own bill (name, items, totals, UPI when something is owed). Links expire after two hours and use their own signing key.

**Fixed**
- **Bill this table** asks which bill to settle when a table has more than one open bill.
- **Reservations**: two bookings can no longer overlap on one table, even when made at the same moment; status only moves forward; the table status follows what is really happening; waitlist seating refuses a held or busy table.
- **Phone app backup** now includes unsent expenses, refunds and collections, and reservations, so a restore does not lose them.
- **Currency** follows the restaurant's setting across the dashboard; the refund amount can no longer start above what can be refunded; a failed gift-card lookup shows an error.
- **Stock** receipts, purchase orders and transfers lock the stock rows they change, so two people working at once cannot corrupt a balance.
- Security, payments, backups and updater hardening from the community pull requests #33 to #45: refunds reverse loyalty points, interrupted online payments recover, backups are checksummed before a restore, the updater rolls back every container it changed, QR ordering and device revocation checks tightened.

**Packages**
- Android app 1.42.0 (versionCode 142000), Windows client 1.0.16.0, `.deb` for amd64 and arm64.
