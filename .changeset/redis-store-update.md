---
'accounts': patch
---

`Store.redis` writes the `backend` plugin's logout index of a `sid` in a `GET` and a conditional `EVAL`, without taking a lock.
