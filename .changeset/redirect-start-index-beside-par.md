---
'accounts': patch
---

Improved `Actions.redirect.start`, which `redirect.signIn` runs: it reads the index of pending redirects beside `createUrl`, so a pushed request (`par`) and the read run in one round. Before, the read waited for the pushed request.
