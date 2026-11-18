---
'accounts': patch
---

Changed `session.refresh` on `Store.memory` outside a browser to throw a refused refresh token after one request, as in a browser. Added `local` to `Store`, which `Store.memory` sets.
