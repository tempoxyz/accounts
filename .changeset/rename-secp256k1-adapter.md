---
'accounts': patch
---

Renamed the `dangerous_secp256k1` adapter to `secp256k1`. The old name is preserved as a deprecated alias so existing imports keep working.

```diff
- import { dangerous_secp256k1 } from 'accounts'
+ import { secp256k1 } from 'accounts'
```
