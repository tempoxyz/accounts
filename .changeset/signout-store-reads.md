---
'accounts': patch
---

Changed `signOut` to read the store's revoked digests and unanswered revocations once each, at once, before the revocation. Before, it read the revoked digests twice and every entry in turn, which cost two more waits on a device's secure store.
