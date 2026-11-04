---
'accounts': patch
---

Fixed `tempoId.signOut()` in two tabs at once revoking the same refresh token twice, which signed the user out of the app on their other devices.
