---
'accounts': patch
---

Changed the message of `Accounts.SignedOutError` for a read of the `viem` plugin's account while the instance reads its saved session or a sign-in runs, such as a transaction in a new run of a CLI. It names `session.get()`, in place of a sign-in that the user does not need.

```ts
const accounts = Accounts.create({ plugins: [device({ onCode }), viem()], store: Store.file(path) })
await accounts.session.get()
await accounts.token.transferSync({ amount, to, token })
```
