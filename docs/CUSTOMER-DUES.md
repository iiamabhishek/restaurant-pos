# Customer credit and dues

A customer can pay part of a bill now and the rest later, or leave a bill unpaid. OrderRestro keeps the bill open, records every payment against it, and shows who owes what.

## Record a part payment or a credit bill

1. In POS (or at checkout) choose the customer. A bill only appears on someone's account when a named customer is attached.
2. Send the order as usual. At checkout, either:
   - enter what the customer is paying now and press **Record partial payment**, or
   - pay nothing: close the checkout. The bill stays open under the customer's name.
3. The bill stays open with the balance. Pressing the button twice or retrying never records the payment twice, and an amount above the balance is refused.

A dine-in table stays open until its bill is settled. Takeaway and delivery bills hold nothing else.

## See who owes money

**Customers → Customer dues** (`/customers/dues`) lists every open bill with a named customer:

- **Status**: everything owed, unpaid, partially paid, or paid.
- **Customer** and **From / To** date filters.
- Each bill shows the total, what was paid, the balance, and its **payment history**.
- **Total outstanding** and the number of customers who owe sit at the top.

## Collect later

- **Record payment** opens the normal checkout for that bill. Enter the amount, pick the method, done. The balance and status update straight away; when it reaches zero the bill is paid and leaves the list.
- **Remind on WhatsApp** opens WhatsApp with a message already written (customer name, bill number, amount due). You review it and press send yourself. Nothing is ever sent automatically. A customer with no valid phone number shows the reason instead of a link.

## API

`GET /api/v1/orders/dues?branchId=…&status=OUTSTANDING|UNPAID|PARTIAL|PAID&customerId=…&from=…&to=…` (needs the `customers.manage` permission). It is read-only; payments go through the existing `POST /orders/:id/checkout`, which is transactional and idempotent via `requestId`.
