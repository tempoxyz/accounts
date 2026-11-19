---
'accounts': patch
---

`Store.memory` now deletes its expired entries once the store doubles its size since the last sweep, instead of on every write, so a write costs constant time on average.
