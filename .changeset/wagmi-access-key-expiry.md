---
'accounts': patch
---

Fixed the `tempoId` connector of `accounts/wagmi` to disconnect wagmi at the expiry of the session's access key, as `session.status` changes to `signedOut`.
