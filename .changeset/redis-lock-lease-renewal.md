---
'accounts': patch
---

Fixed `Store.redis` so that `lock` renews its 30-second lease while the hold runs. Before, a hold that ran longer, such as a slow refresh, lost the lock to another process, which then sent the same refresh token.
