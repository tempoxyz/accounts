---
'accounts': patch
---

Changed fee token resolution in the relay to lazily resolve swap source tokens on `InsufficientBalance` instead of eagerly resolving upfront.
