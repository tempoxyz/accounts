---
"accounts": patch
---

Treated `undefined` as "no value" in `Storage.combine` reads so adapters that return `undefined` for missing keys (Map-backed, custom caches) fell through to the next adapter instead of short-circuiting.
