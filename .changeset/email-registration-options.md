---
'accounts': patch
---

Added `registration` to the `email` plugin's `email.signIn`. With `registration: true`, the sign-in returns the passkey registration options as `registration`, which `passkey.register` takes, so the registration sends no options request.

```ts
const { registration } = await accounts.email.signIn({ code, email, registration: true })
await accounts.passkey.register({ registration })
```

