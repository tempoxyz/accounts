---
'accounts': patch
---

`redirect.signIn` takes `loginHint`, which Tempo ID's sign-in page fills in its email field, ahead of the saved session's email. A refused refresh ends the session. An app that kept the user's email passes it, so the sign-in page holds the address.

```ts
await accounts.redirect.signIn({ loginHint: 'alice@example.com' })
```
