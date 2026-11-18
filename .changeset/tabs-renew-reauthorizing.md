---
'accounts': patch
---

Fixed `session.status` and `accounts.useSession()` in a tab that renews an expired access key while another tab on the same store renews it too. The status is `reauthorizing` with the expired session, not `pending`.
