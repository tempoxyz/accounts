---
'accounts': patch
---

Fixed `Store.redis` to set `connect`, so a `signOut` of one instance empties the session of every other instance on the store in the same process at once.
