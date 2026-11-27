# OrderRestro 1.43.0

Android app only. The server stays on 1.42.2; no database migration.

**Changed**
- First start now asks one question, once: connect to a restaurant server, or use this phone with no server. Choosing "Use on this phone" goes straight to creating the account. Before, a second "Welcome" screen asked the same thing again.

**Performance**
- A sale no longer copies the whole menu to take stock off; only the dishes sold are copied. This removes a large memory spike on phones with little RAM.
- The release build now uses full R8 optimisation, which makes the app smaller and starts faster. Checked on an Android 15 emulator: it starts, shows the connect screen and the phone account screen.

**Packages**
- Android app 1.43.0 (versionCode 143000). Server, `.deb` and Windows client unchanged.
