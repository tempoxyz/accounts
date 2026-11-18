---
'accounts': patch
---

Counted each token response's `expires_in` from the start of its request to `/oauth2/token`, not from its response, so a slow response never sets a session's `expiresAt` past the access token's `exp`. A refresh, a code redemption, an emailed-code sign-in on a backend, and a device grant's poll each set it so.

Added `receivedAt` to `Tokens` and `Session`: when the instance received the tokens. A `session.refresh` that waits for another context's refresh, such as another tab's, returns that refresh's tokens, also when its request started before the call.
