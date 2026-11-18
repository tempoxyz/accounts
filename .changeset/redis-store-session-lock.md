---
'accounts': patch
---

Fixed two processes on one `Store.redis` sending a refresh each with the same refresh token: a session change now also holds the lock of a shared store that sets `lock`, since Web Locks span one process only.
