---
'accounts': patch
---

Changed the default IndexedDB store to open a new connection after the browser closes it, such as when it deletes the site's data, or after a failed open. Before, the page kept the closed connection, so each later sign-in or sign-out rejected with `InvalidStateError` until a reload.
