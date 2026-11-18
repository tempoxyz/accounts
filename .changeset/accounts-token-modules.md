---
'accounts': patch
---

**Breaking:** `AccessToken`, `Challenge`, and `LogoutToken` moved from `accounts/internal` to `accounts`. An API verifies Tempo ID's tokens and challenges, and catches their `InvalidError`, without `accounts/internal`.

```diff
-import { AccessToken } from 'accounts/internal'
+import { AccessToken } from 'accounts'

 try {
   await accounts.verifyMessage({ accessToken, address, message, signature })
 } catch (error) {
   if (error instanceof AccessToken.InvalidError) return unauthorized()
   throw error
 }
```
