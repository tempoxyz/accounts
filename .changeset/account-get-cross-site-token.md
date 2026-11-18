---
'accounts': patch
---

Fixed `account.get` on a page of another site than Tempo ID's, such as after an `email.signIn`, which sent only the session cookie. That cookie is `Lax`, so Tempo ID refused the read with `session_required` while the instance was signed in. The read now sends the session's access token on every page outside Tempo ID's host. Tempo ID's own pages still send the session cookie, with no preflight.

```ts
const session = await accounts.email.signIn({ code, email })
const account = await accounts.account.get()
```
