---
'accounts': patch
---

Added `google_unavailable` to `Accounts.RequestError.Reason`. Tempo ID refuses a Google sign-in with it, with status 503, when the deployment has no Google OAuth client. Only Tempo ID's own sign-in page starts a Google sign-in, so no action of the client package throws it today.
