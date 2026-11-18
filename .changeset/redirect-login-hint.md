---
'accounts': patch
---

Added `loginHint` to `Actions.redirect.createUrl`, sent as `login_hint`. `redirect.signIn` sends the saved session's email, so Tempo ID's sign-in page fills it once the browser's Tempo ID session expired.
