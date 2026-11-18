---
'accounts': patch
---

`dialog({ backend })` loads no hidden frame of Tempo ID on a page whose backend holds a session. The plugin reads `GET {backend}/auth/session` once as the instance is created, and loads the frame only if the route returns no session, or the read fails. Before, every load of a signed-in page loaded the frame, since the page's instance holds no session.
