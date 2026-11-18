---
'accounts': patch
---

`accounts.fetch` and the payers of `accounts.mpp` reject a 402 response whose every Tempo charge names another chain than the access key's with `mpp.ChainError`, before the access key signs, in place of mppx's untyped `No method found` error. `mpp.ChainError.Options` takes an optional `intent`, `'charge'` or `'subscription'`.

```ts
import { ChainError } from 'accounts/mpp'

try {
  await accounts.mpp({ session }).fetch('https://api.example.com/paid')
} catch (error) {
  if (error instanceof ChainError) {
    // The endpoint charges on another chain than the session's access key.
  }
}
```
