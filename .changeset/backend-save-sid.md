---
'accounts': patch
---

Added `sid` to the result of `backend.save`. For a Tempo ID session, such as an emailed code's backend sign-in, `save` returns the `sid` of the session's ID token beside the session ID, as `complete` does, so the app indexes the session for a logout token. Before, `save` returned only the session ID.

```ts
const session = await accounts.email.signIn({ code, email, userIp })
const { id, sid } = await accounts.backend.save({ session })
```
