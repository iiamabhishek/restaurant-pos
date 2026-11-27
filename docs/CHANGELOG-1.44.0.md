# OrderRestro 1.44.0

Server release. Update straight from 1.42.2 (the Android 1.43.0 app works unchanged). One additive database migration.

**Reports**
- New **All bills (day book)** report: every paid bill in the chosen days with date, time, bill number, type, customer, table, how it was paid, discount, tax, tips, total, refunds and who billed it, with a totals line.
- **Daily sales** now has a totals line, and clicking a day opens every bill of that day. Clicking a bill opens it.
- Quick ranges (Today, Yesterday, Last 7 days, This month, Last 30 days). "Today" now means today on your clock; before, shortly after midnight it could still show yesterday.
- Totals are included in the Excel, PDF and CSV exports. Money columns show two decimals.
- Fixed: a PDF export that ran onto a second page dropped the first row of that page.

**Orders**
- History is no longer limited to the last 7 days: pick any date range and search by bill number or guest (up to 500 bills at a time).
- An admin can delete a finished bill straight from the bill's detail window (admin password asked, VERI*FACTU invoices are still protected). Paid bills are still corrected by refund, never edited in place, so the ledger stays correct.

**Audit log**
- The log can be exported to Excel, PDF or CSV (needs permission to view the log and to export data). Exporting is itself recorded.
- The log is permanent. There is no way to edit or delete an entry from the app, and the database now refuses it too.
- Fixed: the "To" date of the log filter left out the whole last day.

**Packages**
- Docker images and `.deb` for amd64 and arm64. Android and Windows clients unchanged.
