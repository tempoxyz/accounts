---
"accounts": patch
---

Added `deferRegistration` to `WebAuthnCeremony.server`. When set, registration answers as soon as the passkey is created and verifies it with the server in the background, retrying requests that fail in transit. The `webAuthn` adapter makes logins and disconnects wait for that verification, keeps the public key in storage until the server acknowledges it, and removes the account if the server rejects it.
