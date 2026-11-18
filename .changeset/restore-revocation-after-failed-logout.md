---
'accounts': patch
---

Fixed a restore, such as `authorize`, that a `signOut` with `everywhere` overtakes, in a first-party app. If Tempo ID refuses the logout, with a status from 400 to 499, the restore revokes the refresh token that it received. A restore that completes during the logout waits for its outcome. The revocation runs under the session's lock and marks the token as revoked, so a later `signOut` with `everywhere` sends its logout after the revocation's answer, and no caller revokes the token again. Before, the restore dropped the token without a revocation, so it stayed valid at Tempo ID. After a logout without an answer, or with a server error, the restore still sends no revocation, since such a logout can have revoked the token.

```ts
const authorized = accounts.authorize()
await accounts.signOut({ everywhere: true }) // rejects: Tempo ID refused the logout
await authorized // rejects with `SupersededError`, after it revokes its refresh token
```
