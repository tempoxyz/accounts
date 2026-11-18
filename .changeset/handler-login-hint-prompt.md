---
'accounts': patch
---

Added the `loginHint` and `prompt` query parameters to `GET /login` of `accounts.handler`, which pass them to `backend.start`. The route drops a `prompt` other than `login`.

```ts
app.get('/', (c) =>
  c.html(
    html`<a href="/api/auth/login?prompt=login">Use another account</a>`,
  ),
)
```
