---
'accounts': patch
---

Fixed the session manager of a fixed `session`, such as one that `accounts.backend.get` returns, once its access key expires. Each request, stream, and top-up of `accounts.mpp({ session }).session()` throws `Accounts.SignedOutError` before any request, and the access key signs nothing, as a manager of the instance's session does. Before, the manager sent the request, and then failed on the chain's refusal of the expired access key. `close()` still settles the channel.

```ts
const manager = accounts.mpp({ session }).session()
await manager.fetch(url) // throws Accounts.SignedOutError once the access key expires
```
