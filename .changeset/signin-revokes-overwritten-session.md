---
'accounts': patch
---

Fixed a sign-in that replaced another context's session in the store, such as a second run of a CLI's `login` on one `Store.file`, and left that session's refresh token live. The sign-in now reads the stored session before its save, and revokes a newer session that the instance never read, beside the sign-in. Before, a later `signOut` never revoked that token.

```ts
await accounts.device.signIn() // revokes the session that another run saved
```
