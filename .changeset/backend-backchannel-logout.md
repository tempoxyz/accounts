---
'accounts': patch
---

Added `POST /auth/backchannel-logout` to `accounts.handler` and `backend.logout` to the `backend` plugin. Each verifies a logout token, and ends each session of its `sid` without a revocation. `backend.complete` and `backend.save` index each session by its `sid`, in the store or in the Durable Object of the `sid`. The index keeps a session that fails to end for the token's retry, and a sign-in of the `sid` that finishes after the token ends at once. A custom `backend.Sessions` adapter adds `close`, `link`, and `unlink` for `backend.logout`. The `logoutToken` option of `backend` takes the options of the verifier.

```ts
const accounts = Accounts.create({
  clientId,
  clientSecret,
  plugins: [backend({ sessions: Sessions.durableObject(env.SESSIONS) })],
})

// Register https://app.example/api/auth/backchannel-logout as the back-channel logout URI.
app.all('/api/*', (c) => accounts.handler.fetch(c.req.raw))
```
