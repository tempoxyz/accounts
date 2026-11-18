---
'accounts': patch
---

Sent the renewal of an expired access key or session as `POST /v1/authorize` alone, with no `GET /v1/auth/session` before it. A renewal by `accounts.authorize`, `session.get` with `reauthorize`, the `react` plugin's mount, and the `viem` plugin's retry now takes one round trip in place of two. Without a Tempo ID session, Tempo ID's `session_required` refusal returns no session, as the check did. Added `check` to `Actions.authorize`, which skips the check with `false`.

```ts
const result = await Actions.authorize(auth, { accessKey, check: false })
if (!result) showSignIn()
```
