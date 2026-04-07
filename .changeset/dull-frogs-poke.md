---
'accounts': patch
---

Fixed the wagmi WebAuthn connector to forward authUrl so server-backed WebAuthn flows correctly called /auth/\* instead of falling back to local-only mode.
