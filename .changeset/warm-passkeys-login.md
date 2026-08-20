---
'accounts': minor
---

Consolidated passkey targeting under `credentialId`, which now accepts one or multiple credential IDs in `wallet_connect`.

```ts
await provider.request({
  method: 'wallet_connect',
  params: [{ capabilities: { credentialId: ['credential-a', 'credential-b'] } }],
})
```
