---
"accounts": patch
---

Sign locally when `wallet_connect` re-authenticates a credential the WebAuthn adapter registered in the same session (for example authorizing an access key right after sign-up), skipping the server authentication options and verification round trips. Disconnecting clears this.
