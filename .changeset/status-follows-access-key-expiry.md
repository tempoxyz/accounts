---
'accounts': patch
---

Fixed `session.status` and `useSession` to change to `signedOut` at the access key's expiry while the instance stays open. The instance empties the session then, as `session.get()` does, and keeps it for the next authorization, so a page shows the sign-out with no read of its own and sends no request.
