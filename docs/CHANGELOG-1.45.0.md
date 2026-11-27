# OrderRestro 1.45.0

Server release. Update straight from 1.44.0 (or 1.43.0's server, 1.42.2). Two additive database migrations; nothing existing is changed or removed.

**Point of sale**
- **Split a bill by guest.** Open a bill, choose Split bill and move items to a new bill, by line or by quantity. Each bill is paid on its own with any payment method. The parts always add up to the original to the cent. [Details](SPLIT-BILLING.md)

**Reports**
- Reports reach back **five years** (before, one year), so old invoices are always reachable. Added Last 90 days, This year and All time.
- Someone who can see sales reports but cannot take orders (an accountant) can now **open any bill read-only** from the day book.
- Find a bill by number, customer or payment in the day book.

**Procurement**
- **Purchase returns:** send goods back against a receipt; stock goes out and the value is credited to the supplier's invoice. [Details](PROCUREMENT.md)
- **Price check:** order price against the price paid against the last price, and invoice against receipt, with moves above your limit highlighted.
- **Shopping list** now counts stock already on order, shows days of cover from real use, the usual supplier and the last price.

**Finance**
- **Expense approvals:** staff submit, a manager approves or rejects with a reason; only approved expenses count anywhere. **Petty cash box:** top-ups, vouchers against receipts, and counts, with an exact running balance. [Details](FINANCE.md)
- **Accounting journal export** (CSV or Excel): balanced double-entry vouchers for sales, refunds, expenses, purchases, supplier payments and returns. [Details](ACCOUNTING-EXPORT.md)

**Delivery**
- **Customer tracking link:** a signed link, valid 12 hours, shows delivery progress and, while the rider is live and sharing a fresh position, distance and a rough arrival time. [Details](DELIVERY-TRACKING.md)

**Fixed**
- The audit log's "To" date left out the whole last day (1.44.0). A PDF export that ran onto a second page lost its first row there.

**Not included** (still planned): direct Zomato/Swiggy API clients and live Tally/Zoho/QuickBooks connectors, which need accounts and credentials from each restaurant, and a live map.

**Packages**
- Docker images and `.deb` for amd64 and arm64. Android and Windows clients unchanged.
