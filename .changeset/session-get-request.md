---
'accounts': patch
---

**Breaking:** Replaced `backend.session({ request })` with `session.get(request)`, the read of a server request's session that the `backend` plugin adds to `accounts.session`. Added `session.fetch(request, { url, init })`, which sends a request with the access token of the request's session. `backend.get` and `backend.fetch` still take a session ID.

```ts
// Before
const session = await accounts.backend.session({ request })
// After
const session = await accounts.session.get(request)
const response = await accounts.session.fetch(request, { url: 'https://api.tempo.xyz/v1/recipients' })
```
