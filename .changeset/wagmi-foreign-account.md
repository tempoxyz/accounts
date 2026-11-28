---
'accounts': patch
---

Fixed the `tempoId` connector of `accounts/wagmi` to throw `Provider.UnauthorizedError` for a signing action whose `account` names another address, in place of sending the message or transaction to the RPC.
