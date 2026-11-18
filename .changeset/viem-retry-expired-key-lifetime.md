---
'accounts': patch
---

Fixed the `viem` plugin's retry after the session's access key expired, on an instance without `accessKey`. The sign-in for a new access key requests the expired access key's lifetime, counted from its request, as `authorize` renews it, so the new access key lives no longer than the first. Before, the sign-in requested no expiry, and Tempo ID filled its default expiry, such as 30 days for an access key of one hour.
