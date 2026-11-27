# OrderRestro 1.47.0

Server release. Update straight from 1.46.0. Two database migrations that tighten delete rules; no data is changed or removed. Contributions by Juan Fontes (#172, #177, #180).

**Staff dashboard**
- **Your language, on every page.** The language picker (English, Spanish, French, Brazilian Portuguese) now translates headings, actions, forms, dialogs, statuses, empty states, dates, numbers and currency across the staff dashboard, not only the sidebar. Names, menu items, notes and other records keep the text that was entered. Guest QR and kiosk pages are unchanged.
- **Menu > Paused.** Lists every paused dish of the branch, earliest return first, with a Resume sales action for managers. Phones get the same view in the category picker.

**Money safety**
- **Financial history is kept.** A bill with a payment or refund can no longer be deleted (refund it instead); a supplier invoice with payments cannot be deleted; deleting a customer keeps their points entries. Bulk deletes are all-or-nothing and return a clear message. Gateway payment links are reserved before the provider is called, so a late provider response cannot expire a confirmed payment.
- Restoring an older backup re-applies these rules.

**Windows and Android**
- Android 1.47.0 (versionCode 147000) includes Nearby phone-to-phone sale copies (beta, Android only; see [OFFLINE-ARCHITECTURE](OFFLINE-ARCHITECTURE.md)).
- Windows 1.0.22.0.

**Packages**
- Docker images and `.deb` for amd64 and arm64.
