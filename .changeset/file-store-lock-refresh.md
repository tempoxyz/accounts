---
'accounts': patch
---

`Store.file` now sets `lock`, so the instances of several processes on one file, such as two runs of a CLI, send one refresh and rotate the refresh token once. Before, each process held its own Web Locks and sent its own refresh with the same token, which a server with refresh token reuse detection can answer by revoking the session. The store of a `cli:` client ID, which loads `Store.file`, uses the same lock. The hold renews its lock file for at most 30 seconds, so a slow refresh keeps the lock and a stalled one releases it. In a runtime without Web Locks, such as Bun or Deno, a run whose store lock rejects before it starts holds the instance's lock in memory alone, so a sign-out still revokes its tokens.
