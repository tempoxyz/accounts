---
'accounts': patch
---

Outside a page, the `tempoId` connector's `isAuthorized` takes the session of the instance's first load when it runs during that load, so a process's first `reconnect` reads the stored session once, not twice.
