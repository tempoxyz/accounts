---
"accounts": patch
---

Fixed WebAuthn credential storage to bind credentials to their registered user id and use atomic duplicate rejection when the configured `Kv` supports it.
