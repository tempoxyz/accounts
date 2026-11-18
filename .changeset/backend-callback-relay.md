---
'accounts': patch
---

Fixed `GET /auth/callback` of the `backend` plugin redirecting a popup of the dialog with `error=invalid_request` when the browser held no redirect sign-in of that `state`, such as a popup of `dialog.signMessage` on a page whose `Cross-Origin-Opener-Policy` severs its opener. The route now returns the page that posts the callback to the dialog's page, and keeps the pending sign-in. In a tab that no script opened, the page returns to `/?error=invalid_request`.
