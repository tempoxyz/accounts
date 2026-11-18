---
'accounts': patch
---

Fixed `account.get` outside a page, such as in a CLI, which sent only the session cookie, so a signed-in instance failed with `session_required`. The read now sends the session's access token there. A page and its workers still send the session cookie.
