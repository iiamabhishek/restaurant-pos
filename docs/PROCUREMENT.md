# Procurement: returns, price check and the shopping list

## Return goods to a supplier
**Inventory → Returns & prices → Return goods.** Pick the goods receipt the items came on, enter how much of each item goes back, and give a reason.
- The quantity leaves stock (oldest batch first, like any other use). It cannot go back if the stock is no longer there; nothing is changed in that case.
- You can return at most what that receipt brought in minus what was already returned. Two people returning the same receipt at once cannot exceed it.
- The value credited is **quantity × the price paid on that receipt**. It is applied to the unpaid invoice recorded for that receipt (or the invoice you choose), and counts like a payment: the invoice shows less left to pay, and shows paid when credit plus payments cover it. Any credit the invoice cannot absorb stays as an open credit with the supplier.
- Returns get a number (PR-0001…), are never edited or deleted, and appear in the Audit Log.
- `GET /api/v1/inventory/procurement/suppliers/:id/balance` gives what you owe a supplier: unpaid invoice balances minus open credit.
- A retried request with the same `clientRequestId` returns the first return instead of taking stock out twice.

## Price check
**Inventory → Returns & prices → Price check.** For the dates you pick, each received line shows the price on the purchase order, the price paid, and the price paid last time for the same item, with the change in percent. Moves at or above your limit (5% to start) are highlighted. A second table compares what each receipt was worth with the supplier invoice recorded for it.
`GET /api/v1/inventory/procurement/price-variance?from=&to=&threshold=&supplierId=`

## Shopping list
**Inventory → Shopping list** lists what to buy: items at or below their minimum, and items that usage says will run out within 3 days. It counts stock already on order (sent or part-received purchase orders), shows days of cover from the last 30 days of use, the usual supplier and the last price paid, and can be downloaded as CSV or printed. "Order up to" is the item's par level, else twice its minimum, else a week of usage.
