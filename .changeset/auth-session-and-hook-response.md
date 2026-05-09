---
'accounts': patch
---

Added `session` option to `Handler.auth` and allowed `onAuthenticate` to return a `Response` whose body and status are merged onto the verify response.
