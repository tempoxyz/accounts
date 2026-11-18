---
'accounts': patch
---

Fixed `accounts.session.get` with `reauthorize` after a sign-out without `everywhere`. The call authorizes nothing, so a `signedOut` status stays `signedOut`. Before, it moved to `pending` and back, so a component that called `accounts.useSession()` after a sign-out rendered every reader of the hook as `pending` once.

```ts
await accounts.signOut()
await accounts.session.get({ reauthorize: true }) // The status stays `signedOut`.
```
