# Accounting journal export

**Accounting → Export journal** (or `GET /api/v1/accounting/export/journal?from=&to=&format=csv|xlsx`) downloads a double-entry journal for the dates you choose. It needs permission to manage accounting and to export data.

Columns: Date, Voucher, Reference, Account, Debit, Credit, Narration. Every voucher balances to the cent; if one ever would not, the export refuses instead of giving you a wrong file.

| Voucher | Debit | Credit |
|---|---|---|
| Sales (one per day) | Cash in hand, and Receipts per payment method | Sales (net of tax, tips and delivery fees), Output tax (included in prices), Tips payable, Delivery income |
| Refund | Sales returns | Cash in hand or the receipt account |
| Expense (approved only) | Expense: category | Cash in hand, Petty cash, or Paid from bank or other |
| Purchase (supplier invoice) | Purchases | Supplier: name |
| Supplier payment | Supplier: name | Cash in hand or the receipt account |
| Purchase return | Supplier: name | Purchases |

Use it to hand your accountant the month, or to import into an accounting package's journal import (you map the account names once). **There is no live connection to Tally, Zoho Books or QuickBooks;** those need each customer's own account and credentials, so they remain planned.
