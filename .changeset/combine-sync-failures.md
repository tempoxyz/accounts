---
"accounts": patch
---

Isolated synchronous storage adapter errors in `Storage.combine` so reads, writes, and removals still reach the remaining adapters, matching the behavior for rejected promises.
