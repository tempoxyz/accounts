---
"accounts": minor
---

Added access-key funding policies with optional inline admins defaulting to the authorizing root account.

```ts
await provider.request({
  method: 'wallet_authorizeAccessKey',
  params: [{ address: key.address, keyType: 'p256', expiry, limits, fundingPolicy: { rules } }],
})
```
