---
'accounts': patch
---

Fell back to in-memory storage in `Storage.idb()` when IndexedDB is unavailable (e.g. React Native/Expo, some SSR), instead of throwing `ReferenceError: indexedDB is not defined` on the first read or write.
