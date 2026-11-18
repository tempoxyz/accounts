---
'accounts': patch
---

**Breaking:** `Actions.account.get` and `Actions.passkey.register` take the chain as `chain` alone, by its name or its ID. Their `chainId` option, a second spelling that `chain` overrode, is removed.

```diff
-const account = await Actions.account.get(auth, { chainId: 42431 })
+const account = await Actions.account.get(auth, { chain: 42431 })
```
