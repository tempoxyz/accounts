---
'accounts': patch
---

Changed the `dialog` plugin to wait for an authorization in progress before it preloads the frame on a page without a saved session. A page that restores its session through the browser's Tempo ID session, such as with `Store.memory` and `react`, now loads no frame of the sign-in.
