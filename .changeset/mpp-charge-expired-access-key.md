---
'accounts': patch
---

Fixed a charge of `accounts.fetch` and of `accounts.mpp({ session }).fetch` whose access key expires while the request waits for its 402 challenge. The charge throws `Accounts.SignedOutError` before the access key signs. Before, the expired access key signed the charge, and the payer sent the credential that the chain refuses, once per retry.

```ts
await accounts.fetch('https://api.example.com/fortune') // Accounts.SignedOutError
```
