---
'accounts': patch
---

**Breaking:** `Actions.account.upgrade` takes the chain as `chain` alone, by its name or its ID. Its `chainId` option, a second spelling that `chain` overrode, is removed.

```diff
-await Actions.account.upgrade(auth, { chainId: 42431, key })
+await Actions.account.upgrade(auth, { chain: 42431, key })
```
