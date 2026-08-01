---
'accounts': minor
---

Added CLI device code approval for updating published and pending access key spending limits.

```ts
await provider.request({
  method: 'wallet_updateAccessKey',
  params: [
    {
      address: accountAddress,
      accessKeyAddress,
      limits: [{ token, limit }],
    },
  ],
})
```
