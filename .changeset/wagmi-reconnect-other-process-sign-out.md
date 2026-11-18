---
'accounts': patch
---

Outside a page, the `accounts/wagmi` `tempoId` connector reads the store again at `isAuthorized` and `reconnect` also while it holds a session, so `reconnect` disconnects once another process's sign-out empties a shared store, such as `Store.file`.
