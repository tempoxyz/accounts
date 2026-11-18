---
'accounts': patch
---

Changed `email.signIn` and `passkey.signIn` on a page to revoke the refresh token of a sign-in's authorization that they refuse, such as one without the challenge's signature, an unreadable ID token, or another user's tokens. No session held that refresh token before, and it stayed valid at Tempo ID.

```ts
await accounts.email.signIn({ challenge, code, email }) // throws signedIn, and revokes the refresh token
```
