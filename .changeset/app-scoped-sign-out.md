---
'accounts': minor
---

Changed `tempoId.signOut()` to revoke only the app's refresh token, and added `everywhere`, which ends the Tempo ID session for a first-party app and throws `Accounts.EverywhereNotAllowedError` otherwise.

```diff
- await tempoId.signOut()
+ await tempoId.signOut({ everywhere: true })
```
