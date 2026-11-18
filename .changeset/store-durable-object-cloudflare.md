---
'accounts': patch
---

**Breaking:** `Store.durableObject` moves from the main entry to `accounts/cloudflare`, whose `Store` holds it beside the other stores.

```diff
-import { Store } from 'accounts'
+import { Store } from 'accounts/cloudflare'

 const store = Store.durableObject(this.ctx.storage)
```
