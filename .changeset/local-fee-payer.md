---
"accounts": patch
---

Added local fee payer accounts to provider configuration for locally signable senders and managed access keys.

```ts
import { Provider, webAuthn } from 'accounts'
import { privateKeyToAccount } from 'viem/accounts'

const provider = Provider.create({
  adapter: webAuthn(),
  feePayer: privateKeyToAccount('0x...'),
})
```
