---
'accounts': patch
---

**Breaking:** Added `Permissions.fromAccessKey`, which returns the chain, the limits in base units, and the scopes of an access key's signed authorization. It replaces `AccessKey.permissions` of `accounts/internal`.

```diff
-import { AccessKey } from 'accounts/internal'
+import { Permissions } from 'accounts'

-const { limits } = AccessKey.permissions(session.accessKey)
+const { limits } = Permissions.fromAccessKey(session.accessKey)
```
