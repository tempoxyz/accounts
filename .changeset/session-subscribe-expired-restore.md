---
'accounts': patch
---

`session.subscribe` no longer calls its listener for a saved session whose access key expired, at its restore. `session.get` empties that session, so a listener, such as the `wagmi` connector's, received a sign-in of the expired session and then a sign-out. A listener now receives the session that the restore or the next authorization sets.

```ts
accounts.session.subscribe((session, previous) => render(session))
// A returning user whose access key expired: no call, and the status becomes `signedOut`.
await accounts.session.get()
```
