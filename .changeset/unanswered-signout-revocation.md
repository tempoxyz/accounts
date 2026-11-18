---
'accounts': patch
---

Fixed `signOut` for a revocation that receives no answer, such as on a device that is offline. The refresh token of that sign-out stayed live, since the store no longer held it. The store now keeps it, and the next `signOut` revokes it beside its own refresh token, with no extra round trip.

```ts
await accounts.signOut().catch(() => {}) // Offline: the revocation receives no answer.
await accounts.redirect.signIn()
await accounts.signOut() // Revokes both refresh tokens.
```
