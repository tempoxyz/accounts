---
'accounts': patch
---

Fixed `session.get` for a saved session whose access key expired, when the revocation of its refresh token receives no response, such as on a device that is offline. The store keeps the refresh token, or the instance when the store refuses it, and the next `signOut` revokes it. Before, the instance dropped the token, so it stayed valid at Tempo ID until the end of its lifetime.

```ts
await accounts.session.get() // undefined, offline
await accounts.signOut() // online: revokes the expired session's refresh token
```
