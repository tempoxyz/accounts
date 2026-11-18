---
'accounts': patch
---

Fixed `GET /auth/login` of the `backend` plugin when Tempo ID refuses the start of the sign-in, such as a pushed request to `/oauth2/par` without a response. The route answers with the refusal's error body and status, or 503 `temporarily_unavailable` for no response, a 429, or a 5xx, and sets no cookie. Before, `accounts.handler.fetch` rejected, so a Worker answered 500. A fault of the instance's own options, such as `expiry_passed`, still rejects.

```ts
// GET /api/auth/login with Tempo ID unreachable → 503 { error: 'temporarily_unavailable' }
app.all('/api/*', (c) => accounts.handler.fetch(c.req.raw))
```
