---
'accounts': patch
---

Fixed `backend.logout` on a store that several processes share, such as `Store.redis`. A logout token that one process received while another process linked a sign-in of the same `sid` could leave that session signed in, and reopen the `sid` for later sign-ins. The close of a `sid` now writes its own key, `tempo-id:logout:<sid>`, which no sign-in rewrites, and each sign-in reads it after its link.
