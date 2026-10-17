---
"accounts": patch
---

Added `deferRegistration` to `WebAuthnCeremony.server`. When set, registration answers as soon as the passkey is created and verifies it with the server in the background, retrying requests that fail in transit. The `webAuthn` adapter makes logins and disconnects wait for that verification. If the server rejects the registration, or the page closes before it answers, the adapter removes the account and its access keys and keeps the public key in storage; a later login with the passkey restores the account. `WebAuthnCeremony.server` now also ends its session on `wallet_disconnect` when passed as `ceremony`.
