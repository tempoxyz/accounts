---
'accounts': patch
---

Fixed `signOut` of a saved session, when the revocation of its refresh token receives no response and the store refuses the write that keeps the token. The instance keeps the token, and its next `signOut` revokes it. Before, the instance dropped the token, so the next `signOut` resolved without a revocation.

```ts
await accounts.signOut() // rejects: offline, and the store is full
await accounts.signOut() // online: revokes the refresh token
```
