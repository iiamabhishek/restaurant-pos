# OrderRestro 1.42.1

A safety and reliability release. No database migration; update as usual.

**Money**
- Two tills can no longer overpay one open bill. A retried payment is a replay, never a second charge.
- A refund to a gift card credits exactly the amount refunded, capped at what was paid by card; it is refused on a bill paid without one.
- Online-payment refunds: an unclear answer from the provider (timeout, 409, 429, 5xx) keeps the hold for review instead of risking a second refund; a refund the provider has not finished stays reconcilable; owners can close a reviewed entry in Settings → Payments.
- The GST report matches the tax stored on the bills (loyalty points are tender, not a discount).
- Bank statement lines that are money-in cannot be matched to an expense, and one expense can back only one line.
- Customer dues stay fast on very long lists; if the detail list is capped the page says so and the totals still include everything.

**Stock**
- Goods received into negative stock keep the balance equal to the movement history.
- A stock take sent twice applies once. Concurrent stock-journal work no longer exhausts the database connection pool.
- A recipe-tracked dish can no longer be left without a recipe through the API.

**Permissions and security**
- A DENY override also removes a permission that was only implied by another one, and editing someone's overrides follows the same "nobody can manage an account stronger than their own" rule.
- The S3 backup secret and the sync API key are encrypted at rest; existing values keep working and are re-encrypted the next time they are saved.

**Phone app**
- A failed save during checkout no longer leaves stock half-deducted, and an interrupted sale is resumed instead of repeated after a restart.
- Restoring a backup, including older ones, continues receipt, order and KOT numbering instead of restarting at 001.

**Web**
- Sidebar keyboard focus and ARIA state are correct, and the sidebar no longer stays open after focus leaves.
- Clearing a menu photo sticks; barcode scans work from any category; the AI assistant says which model answered and switching threads cancels a pending reply.

**Packages**
- Android app 1.42.1 (versionCode 142100), `.deb` for amd64 and arm64. The Windows client is unchanged (1.0.16.0).
