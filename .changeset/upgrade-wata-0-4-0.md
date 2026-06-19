---
"accounts": patch
---

Upgraded the `wata` dependency to `0.4.0` and migrated the `postMessage` and `mobileWebAuth` adapters to its synchronous `wata.start()` session API (the session is now returned directly instead of a `Promise`).
