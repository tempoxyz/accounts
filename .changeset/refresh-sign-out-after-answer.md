---
'accounts': patch
---

Fixed a `signOut` that empties the session while a `session.refresh` of the same instance reads the store after Tempo ID's answer. The refresh now revokes its new refresh token and saves no session, and the sign-out never revokes the rotated one. Before, in a browser, the refresh saved the new session and its access key again, so `signOut` resolved while the instance and the store still held them. Outside a browser, the session stayed empty, but the sign-out revoked the rotated refresh token, and the new one stayed live.

Fixed a `signOut` that empties the session after a refresh of the same instance read it from the store, and before that refresh starts its change. The refresh now sends no request and sets no session, also a refresh that a request starts. Before, the refresh sent the refresh token and saved the new session again, or saved the session that the sign-out ended, so `signOut` resolved while the instance held a session and its access key.

```ts
void accounts.session.refresh()
await accounts.signOut() // The answer of the refresh arrives here: no session stays, and no live token.
```
