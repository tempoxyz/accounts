---
"accounts": patch
---

Prompt for the passkey while the WebAuthn ceremony registers the login challenge when the credential is already known (stored account or this session's registration), instead of after the `/login/options` round trip. Falls back to the ceremony's options if they differ from the locally built ones.
