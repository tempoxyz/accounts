---
'accounts': patch
---

**Breaking:** `Actions.passkey.register` and `passkey.register` take one of two sets of options. A registration with `accessKey` takes `challenge`, and a registration without `accessKey` takes `account`, `chain`, and `key`. The types refuse a mix, which threw `invalid_request` before.

```diff
 // A registration with `accessKey` joins no account:
-const result = await accounts.passkey.register({ accessKey, account, chain })
+const result = await accounts.passkey.register({ accessKey })

 // A registration that joins an account signs no challenge:
-const result = await accounts.passkey.register({ account, chain, challenge })
+const result = await accounts.passkey.register({ account, chain })
```
