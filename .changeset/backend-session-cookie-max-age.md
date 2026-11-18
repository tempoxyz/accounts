---
'accounts': patch
---

Fixed the session cookie of the `backend` plugin's routes, which ended when the browser closed. `GET /auth/callback`, `POST /auth/callback`, and `POST /auth/siwe/verify` set `__Host-tempo-id.sid` with a `Max-Age` until the store deletes the session: one day after the access key's expiry, or at a SIWE session's expiry. A session without an expiry keeps its cookie for 400 days. A returning user's browser thus names the session after a restart, and `session.get(request)` restores it without a sign-in.

```ts
const session = await accounts.session.get(request)
```
