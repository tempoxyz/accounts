---
'accounts': patch
---

Added `lock` to `Store.redis`. Replicas of a backend that share one Redis now write the logout index of each `sid` one at a time, so a logout token ends every session of the `sid`, also of two sign-ins that reach different replicas at once. The lock sets `<key>:lock` to a token of the hold with `SET`, `NX`, and a 30-second lease, and releases it with an `EVAL` that deletes only that token.
