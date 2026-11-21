---
'accounts': patch
---

Changed the `dpop` plugin to send no query to a shared JSON store, such as `Store.postgres` or `Store.redis`, which can hold no DPoP key, so its factory no longer reads the store, or creates `Store.postgres`'s table, at each load.
