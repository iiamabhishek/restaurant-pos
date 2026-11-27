# Splitting a bill and paying with several methods

- **Several payment methods on one bill** (for example part cash, part UPI): add each payment in the checkout panel. Each carries its own method and reference; the bill closes when they add up. A part payment can also be left open as a balance.
- **Split a bill by guest:** open the bill, choose **Split bill**, and move items to a new bill with the + and − buttons. A line can be split by quantity (move 1 of 3). The new bill opens straight away so it can be paid on its own, with any method.
  - The two bills always add up to the original, to the cent: the moved share of a line is rounded once and the other bill keeps the exact remainder.
  - Only an open bill with nothing paid on it can be split, at least one item stays on the original, and delivery and online orders cannot be split.
  - Pressing the button twice (or a retry) makes one new bill, not two.
  - Kitchen tickets already sent stay with the original order; the new bill is for payment.
- The "Split between" box in the checkout panel is only a calculator for an equal share.
API: `POST /api/v1/orders/:id/split` with `{ lines: [{ orderItemId, quantity }], requestId }`.
