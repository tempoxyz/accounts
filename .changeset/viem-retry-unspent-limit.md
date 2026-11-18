---
'accounts': patch
---

Changed the `viem` plugin's `limit` retry to reject with the transaction's error, and show no sign-in, when the access key spent none of its limits. Before, a transaction above a whole limit opened the sign-in for a new access key with the same limits, which replaced the session's access key and failed again.
