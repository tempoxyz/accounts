---
'accounts': patch
---

Outside a page, the `viem` plugin starts a read of the instance's session when a transaction of its expired access key rejects with `Accounts.SignedOutError`. The read empties the expired session and revokes its refresh token, and `session.status` changes to `signedOut`, so `useSession` renders the sign-in in place of the expired session.
