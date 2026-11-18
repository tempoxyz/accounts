---
'accounts': patch
---

Fixed a sign-in over a session that left the refresh token of the replaced session live. The sign-in now revokes it beside the commit, under the lock, so a later `signOut` leaves no token live, also when another tab signed in. Each refresh records its rotation in the store, so a sign-in in a tab that still holds a token that another tab rotated revokes its successor, and never the rotated token, whose revocation counts as a reuse. A refresh that the sign-in overtakes revokes its own new token. A refresh records its pending rotation before its request, and a refresh whose record fails sends no request. A revocation without an answer enters the unanswered entry, so the next `signOut` sends it again. `context.session.change()` returns `prepare`, which records the pending rotation.

```ts
await accounts.email.signIn({ code, email }) // revokes the earlier session's refresh token
```
