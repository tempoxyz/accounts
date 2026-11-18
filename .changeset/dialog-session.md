---
'accounts': minor
---

Added `accounts.dialog.session`, which returns the session that the page shows. With `backend`, it returns the session of the backend's `GET /auth/session`, or `null`, and its first call takes the read of the dialog's preload, so a page that restores a returning user's session reads the route once in place of twice.
