---
'accounts': patch
---

Changed the `mpp` plugin to share the `viem` plugin's record of the access keys that the chain registered, in the instance's `store`. A `pull` charge that registers an access key now adds it to the record. Before, the next charge, a charge of a new instance on the store, and a transfer of the `viem` plugin attached the key authorization again, and the chain refused it, so each sent 4 or 5 more RPC requests.

```ts
const accounts = Accounts.create({ plugins: [viem(), mpp()], store: Store.file(path) })

await accounts.fetch(url) // registers the access key: 1 RPC request
await accounts.fetch(url) // 1 RPC request, before 5
```
