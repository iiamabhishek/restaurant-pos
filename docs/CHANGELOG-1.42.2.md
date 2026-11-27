# OrderRestro 1.42.2

Update straight from 1.42.0 or 1.42.1 to this version. No database migration.

**Fixed**
- In 1.42.1, several payment attempts for the same bill at the same moment (for example a double tap and a retry together on a small server) could all fail with "Something went wrong" while the server waited on itself. Nothing was charged and a retry worked. Checkout now prepares its branch and coupon information before it starts the transaction.
- Stock-journal actions (stock take, receipts, adjustments, transfers, production quality) no longer need a second database connection while one is already held, the same kind of stall under heavy simultaneous use.

Everything in [1.42.1](CHANGELOG-1.42.1.md) is included.

**Packages**
- Android app 1.42.2 (versionCode 142200), `.deb` for amd64 and arm64. The Windows client is unchanged (1.0.16.0).
