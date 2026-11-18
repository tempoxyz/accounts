---
'accounts': patch
---

Changed `backend.get` and `backend.fetch` with `store` to send a refresh that Tempo ID refuses with `invalid_grant` once more after one second. Before, a refresh that overlapped one of another process that shares the store ended the session, and every process that read it returned `undefined`.
