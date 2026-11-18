---
'accounts': patch
---

Revoked the refresh token that an instance drops when it adopts another context's session, such as another tab's or another process's on one `Store.file`. Two contexts that sign in at once can each save before the other reads the store, so the later save overwrites a session that no sign-in revoked. The instance that adopts the stored session now revokes its own refresh token in the background, unless another context rotated it into the stored session or still keeps it. A later sign-out thus leaves no live refresh token of the store's sign-ins.
