---
'accounts': patch
---

Removed the revocation that a sign-in through the `backend` routes sent for the session that the cookie named before. `GET /auth/callback`, `POST /auth/callback`, and `POST /auth/siwe/verify` now delete that session without a request, as `backend.save` does. If Tempo ID ended that session, such as at a sign-out of Tempo ID, the revocation read as reuse, and revoked the new session's refresh token, so its first refresh signed the user out. A sign-in over a session now sends one request.

```ts
app.all('/api/*', (c) => accounts.handler.fetch(c.req.raw)) // GET /api/auth/callback: POST /oauth2/token only
```
