---
'accounts': patch
---

Fixed a redirect's sign-in that fails after its code exchange, such as on a token response whose ID token is absent or unreadable, keeping the instance's earlier session. `Actions.redirect.complete`, `Actions.redirect.handleCallback`, and `Actions.redirect.handleResult` now throw each failure of the read of the token response as `Accounts.RequestError` with `signedIn`. An instance then empties its session, and revokes the refresh token of the session that it ends, also for `dialog.signIn`. A posted authorization whose `state` is not the pending sign-in's stays without `signedIn`. A fault of the app's own access key still throws as it is, without `signedIn`: `AccessKey.SignerRequiredError` for a callback without `accessKey`, and `AccessKey.KeyTypeError` for an authorization of a configurable account.

`Backend.callbackStatus` returns 503 for a refusal with `signedIn` and a status below 400. `POST /auth/callback` of the `backend` plugin, which completes `dialog.signIn({ backend })`, thus answers 503 in place of 400 for an unreadable ID token, which has `server_error` and status 200.

```ts
const refusal = await Actions.redirect
  .handleCallback(auth, { pending, url })
  .catch((error: unknown) => error)
// `true` for a token response without an ID token, which was `false` before.
if (refusal instanceof Accounts.RequestError) refusal.signedIn
```
