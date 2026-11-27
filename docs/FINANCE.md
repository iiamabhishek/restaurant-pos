# Finance: expense approvals and the petty cash box

## Expense approvals
- Staff who have **Submit Expenses for Approval** (`expenses.submit`, given to Cashiers by default) enter an expense and it waits as **Pending**.
- Staff who have **Approve or Reject Expenses** (`expenses.approve`) see a "Waiting for your approval" list at the top of **Accounting → Expenses**. Approve it, or reject it with a reason (the reason is required and the submitter sees it).
- Anyone with **Manage Accounting** keeps working as before: their expenses are approved at once, because `accounting.manage` includes both permissions.
- Only **approved** expenses count: cash closing, profit and loss, budgets, the balance sheet and bank matching all ignore pending and rejected ones. Expenses recorded before this feature are approved.
- A decision happens once. Two approvers (or a double click) cannot both decide the same expense; the second gets "already decided". A retried submit with the same request id adds one expense.
- Every submit, approval and rejection is in the Audit Log.

## Petty cash box
**Accounting → Petty cash** keeps one box per branch as a running ledger. The balance is always the sum of the ledger rows, in exact decimals.
- **Top up** adds cash to the box.
- **Pay out (voucher)** takes cash out against a receipt (who was paid, receipt number) and records the matching expense under the category you choose. It cannot take out more than the box holds, even when two people pay out at the same moment. The expense follows the approval rules above; if it is rejected, the money goes back into the box.
- **Count the box** compares the cash you counted with the book. A difference is posted as an adjustment so the book matches the cash again, and the count (counted, book, difference) stays in the list.
- Rows are never edited or deleted. Voucher expenses are paid from the box, not the till, so they do not change the daily cash closing.
- Needs the **Keep the Petty Cash Box** permission (`pettycash.manage`, included in Manage Accounting).

API: `GET/POST /api/v1/accounting/expenses`, `POST /expenses/:id/approve|reject`, `GET /expenses/pending|mine`, `GET /petty-cash`, `POST /petty-cash/topups|vouchers|counts`. All writes accept an optional `clientRequestId`.
