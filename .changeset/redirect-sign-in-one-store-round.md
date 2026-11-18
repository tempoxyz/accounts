---
'accounts': patch
---

`redirect.signIn` reads the stored chain selection, the saved session's email, and the sign-out flag in one store round. Before, the session and the flag waited for the chain selection, so a sign-in on an instance that had read no session took two store rounds before `open` or the redirect.
