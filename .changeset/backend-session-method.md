---
'accounts': patch
---

**Breaking:** `backend.get` and `session.get(request)` return a union that `method` discriminates: `tempo-id` for a Tempo ID session, `siwe` for a session of the `siwe` plugin, and, from `session.get(request)` with `accessToken`, `access-token`. Each session of a cookie holds its session ID as `id`. `backend.Session` is the union, and `backend.Session.TempoId` the former type. `GET /session` and `POST /callback` return `method` beside `account` and `user`. Narrow before a read of a Tempo ID session's fields.

```ts
const session = await accounts.session.get(request)
if (session?.method !== 'tempo-id') return unauthorized()
await accounts.viem({ session }).token.transferSync({ amount, to, token })
```
