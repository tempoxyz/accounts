---
'accounts': patch
---

Fixed `session.refresh` in a browser when another tab signs out during it: the refresh returns `undefined` and revokes its new tokens, as on every other store, and the status stays `signedOut` instead of showing the signed-out user again until that tab's sign-out revoked them.
