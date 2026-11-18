---
'accounts': patch
---

Fixed `accounts.fetch` of the `mpp` plugin in a browser for a 402 challenge that follows a sign-out, also one of another tab. Before, a browser's payer compared no session, and the access key of the ended session signed the charge. The payer's `fetch` now rejects with `Accounts.SignedOutError` before the access key signs, also after a sign-in of another user. The charge account also refuses a signature once the session no longer holds the payer's user and Tempo Account, such as after a sign-out while the charge prepares its transaction. A later sign-in of the same user in the same instance does not resume the access key for a request that started before the sign-out.

```ts
const pending = accounts.fetch(url)
await accounts.signOut() // or a sign-out in another tab
await pending // rejects with Accounts.SignedOutError before the access key signs
```
