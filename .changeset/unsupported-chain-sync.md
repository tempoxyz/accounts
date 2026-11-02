---
"accounts": patch
---

Reject unsupported connect chains before changing provider state. Await remote chain synchronization and return failures to the requesting app instead of leaking unhandled rejections. Skip chain/account checks for settled queues, and prevent stale synchronization from reopening approvals or racing newer chain selections. Restore unsupported persisted chain selections to the configured default, and preserve unbound remote subscription callbacks.
