---
'accounts': patch
---

`signOut` joins a sign-out in progress that has not emptied the session yet. Two calls of `signOut({ everywhere: true })` at once, such as two clicks of a sign-out button, send one revocation and one logout instead of two each, and both settle with that logout's result.

```ts
await Promise.all([
  accounts.signOut({ everywhere: true }),
  accounts.signOut({ everywhere: true }),
]) // POST /oauth2/revoke, POST /v1/auth/logout
```
