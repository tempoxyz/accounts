---
'accounts': patch
---

`passkey.signIn` and the handle of `passkey.prepare` now throw `Accounts.SupersededError` with no passkey prompt when a `signOut` completes before the prompt, and send no assertion when it completes during the prompt. Before, the call showed the prompt, sent `POST /v1/auth/passkey/verify`, and then revoked the refresh token that it received.
