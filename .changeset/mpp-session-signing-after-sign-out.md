---
'accounts': patch
---

Fixed a session manager of the instance's session that paid after the sign-out for a request that started before it, such as a 402 challenge that arrived later or a voucher that a stream requested. The manager's access key now refuses each signature once the session ends, with `Accounts.SignedOutError`. `close()` still settles the channel at the amount that the access key signed for.

```ts
const manager = accounts.mpp.session()
const pending = manager.fetch(url)
await accounts.signOut()
await pending // rejects with Accounts.SignedOutError before the access key signs
```
