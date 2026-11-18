---
'accounts': patch
---

Changed `session.refresh` in a browser to throw a refused refresh token's `invalid_grant` at once. Before, it sent the refused token again after one second, which cost a second request and delayed the sign-out after a remote revocation.
