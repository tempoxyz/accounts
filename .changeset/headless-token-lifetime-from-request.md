---
'accounts': patch
---

Fixed `expiresAt` of the tokens from `email.signIn`, `passkey.signIn`, and `authorize` on a page. Their access token's lifetime counts from the start of the request that issued it, as for a refresh. Before, it counted from the response, so a slow sign-in set `expiresAt` after the token's `exp`, and `session.fetch` could send an expired access token.
