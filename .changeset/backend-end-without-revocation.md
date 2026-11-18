---
'accounts': patch
---

Added `revoke` to `backend.end`. With `revoke: false`, `end` deletes the session without a request, for a session that Tempo ID ended, such as one that a logout token names. Before, `end` always revoked the session's refresh token, which Tempo ID read as reuse after a logout, and which revoked the user's other sessions of the app.

```ts
await accounts.backend.end({ id, revoke: false })
```
