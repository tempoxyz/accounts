---
'accounts': minor
---

Added CLI device code approval for updating access key spending limits.

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
