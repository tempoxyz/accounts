---
'accounts': patch
---

Fixed `GET /auth/callback` of the `backend` plugin refusing a sign-in whose `GET /auth/login` or `POST /auth/login` ran at the same time as a request of another tab. Each sign-in in progress now has a cookie of its own, `__Host-tempo-id.pending.<id>`, so a response never replaces another tab's sign-in. Before, every tab rewrote one `__Host-tempo-id.pendings` cookie, so the response that arrived last dropped the other sign-in, whose callback returned the dialog's relay page, and then `/?error=invalid_request`.

The routes still read `__Host-tempo-id.pendings`, and move its sign-ins to cookies of their own at their next write. `__Host-tempo-id.pending` and `__Host-tempo-id.return` still hold the newest sign-in for the earliest release.
