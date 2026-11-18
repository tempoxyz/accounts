---
'accounts': patch
---

`Sessions.durableObject` returns no session for a session ID whose Durable Object name exceeds 1024 bytes, such as the value of a crafted cookie. Such an object reads no name, so each call threw `Invalid Durable Object name`. `session.get(request)` and `backend.get` now return `undefined`, `GET /auth/session` returns `null` and deletes the cookie, and `backend.complete` throws `Accounts.PendingNotFoundError`, as with `store`.
