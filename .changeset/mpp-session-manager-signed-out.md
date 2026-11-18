---
'accounts': patch
---

Changed the session manager of `accounts.mpp.session()` to reject each request, stream, and top-up with `Accounts.SignedOutError` before any request, once the instance's session ends, names another user or Tempo Account, or the manager's access key expires. Before, the manager kept paying with the signed-out or expired access key. The manager stays ended after a later sign-in, also of the same user. A new access key of the same user without a sign-out keeps the manager paying with its own. `close()` still settles the channel.
