---
'accounts': patch
---

Fixed `redirect.signIn` with `open`, `Actions.redirect.handleCallback`, and `backend` throwing a callback's denial, such as `access_denied`, with status 400, `field: 'code'`, and no `uri`. The denial now has status 0, no `field`, and the callback's `error_uri`, as on the callback's page.
