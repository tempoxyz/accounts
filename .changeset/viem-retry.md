---
'accounts': minor
---

Added `retry` to the `viem` plugin, which opens Tempo ID's deposit page or sign-in in a frame after the node refuses an access key transaction, then sends it again.

```ts
viem({ retry: { balance: true, key: true, limit: false } })
```
