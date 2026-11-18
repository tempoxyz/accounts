---
'accounts': patch
---

Fixed `passkey.register` after `signOut` without `everywhere`, and after a `signOut` with `everywhere` that rejects, such as for a logout without a response. Until the next sign-in, the call throws `Accounts.RequestError` with the reason `session_required` and status 0, before any request or prompt. Before, the registration used the browser's Tempo ID session, which the sign-out keeps, so the new passkey joined the account of the user who signed out. Plugins read the same mark through `context.session.signedOut`.

```ts
await accounts.signOut()
await accounts.passkey.register() // throws session_required
```
