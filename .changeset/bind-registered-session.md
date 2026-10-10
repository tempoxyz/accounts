---
"accounts": patch
---

Limit the WebAuthn adapter's post-registration signing shortcut to the most recent registration, for 5 minutes, so it only applies while that registration still owns the server session. Any later registration, server login or disconnect falls back to server authentication.
