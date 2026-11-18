---
'accounts': patch
---

Fixed a live refresh token after a sign-out that a redirect sign-in follows at once, such as at a switch of account. Without `open`, `redirect.signIn` leaves the page only after the sign-out settles. Before, the page left while the revocation ran, the browser aborted it, and the refresh token stayed live. Plugins read the wait as `context.session.ended`. A sign-out's logout now aborts after 10 seconds without a response and throws `Accounts.RequestError` with status 0, so a stalled logout never holds the sign-in.

```ts
void accounts.signOut()
await accounts.redirect.signIn()
```
