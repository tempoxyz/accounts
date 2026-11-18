---
'accounts': patch
---

`Actions.redirect.handleCallback`, `Actions.redirect.complete`, and `redirect.signIn` revoke the refresh token of a token response that they refuse after the code exchange, such as one without a key authorization or with an ID token that does not parse. No session holds that refresh token. Before, it stayed valid until it expired.
