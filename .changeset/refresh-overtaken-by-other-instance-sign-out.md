---
'accounts': patch
---

Fixed `session.refresh` outside a browser, such as in React Native, Node, and a CLI, when another instance on the same store signs out during the refresh. The refresh dropped its new tokens without a revocation, so the new refresh token stayed live. The refresh now revokes its new tokens, and marks the sent refresh token revoked. A sign-out that waits for the refresh's lock, such as in another instance of the same Node process, then skips the rotated refresh token, which Tempo ID counts as a reuse. Without a lock that both instances share, such as in React Native or in two processes, the sign-out can still revoke the rotated refresh token.
