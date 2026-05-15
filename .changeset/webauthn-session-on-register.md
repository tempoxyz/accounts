---
'accounts': patch
---

Issued a `Handler.webAuthn` session on successful registration (matching `/login`), revoked it via `wallet_disconnect` in the WebAuthn adapter, and surfaced a consistent base64url-encoded `userId` across `/register` and `/login`.
