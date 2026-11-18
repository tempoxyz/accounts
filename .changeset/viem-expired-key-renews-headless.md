---
'accounts': patch
---

Changed the `viem` plugin's retry of a transaction of an expired access key on a page. The retry now authorizes the browser's Tempo ID session for the new access key, as `authorize` does, with no screen. If that authorization fails, the embedded sign-in shows, as before. Before, the sign-in always showed, which for a page without `tempo-id:iframe` opened a **Continue** prompt and a popup. A canceled retry stops waiting for the renewal at once, and a renewal that the retry discards ends through the new `context.session.discard`, whose unanswered revocation the next sign-out sends again.

```ts
const accounts = Accounts.create({ plugins: [email(), viem()] })
// The access key expired: the transaction renews it with no screen, and sends.
await accounts.token.transferSync({ amount, to, token })
```
