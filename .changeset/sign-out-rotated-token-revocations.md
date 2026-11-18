---
'accounts': patch
---

Fixed a `signOut` that revoked a refresh token that Tempo ID had already rotated, which Tempo ID counts as a reuse, and which left the new refresh token live.

- A `signOut` in another tab that waits for the lock of a `session.refresh`, after a `signOut` of the refresh's own tab. The refresh now marks the token that it sent as revoked once Tempo ID answers with new tokens, so the other tab's sign-out sends no revocation of it.
- A `signOut` whose read of the store returns after a `session.refresh` of the same instance saved its new session. The sign-out now revokes the refresh token of the session that it empties.

Fixed a `signOut` whose read of the store returns after a sign-in of the same instance set its session, such as a sign-in of another user. The sign-out now waits for the save of that session and reads the store again. It revokes the refresh token of the session that it empties, and the stored session's too when the store refused the save. Before, one of those tokens stayed live until it expired.

Fixed a read of the store that set the stored session again after a `signOut` of the same instance emptied the session, such as the read of a `session.refresh` after Tempo ID's answer. Before, `signOut` resolved while the instance held the session and its access key, with a refresh token that Tempo ID no longer accepts.

Fixed a read of the store during a `signOut` of the same instance that set the session that another tab's `session.refresh` saved after the sign-out emptied the store. The sign-out now ends that session: it empties the store again, and revokes the later refresh token. Before, `signOut` resolved while the instance and the store held the later tokens, and it revoked the rotated refresh token.

Fixed a revocation without an answer, such as on a device that is offline, of a refresh token that only the caller holds: the new token of a `session.refresh` that a `signOut` overtook, and the token of a restore, such as `authorize`, that a `signOut` overtook. The call still rejects with `Accounts.RequestError`. The store now keeps the token, or the instance when the store refuses it, and the next `signOut` revokes it. Before, no later call revoked the token, so it stayed live until it expired.

```ts
const refreshed = accounts.session.refresh()
await accounts.signOut()
await refreshed.catch(() => {}) // Offline: the revocation of the new token receives no answer.
await accounts.signOut() // Revokes the new token.
```
