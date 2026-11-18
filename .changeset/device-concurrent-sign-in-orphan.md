---
'accounts': patch
---

Fixed a sign-in whose save replaced another context's later sign-in on one store, such as in two runs of a CLI's login at once, leaving a live refresh token that no store held. The sign-in now takes that session back and revokes its own token.
