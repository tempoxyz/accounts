---
"accounts": patch
---

`WebAuthnCeremony.deferred` now also answers a login with a known passkey as soon as its signature checks out against the stored public key, and verifies it with the server (`POST /login`) in the background. `verifyAuthentication` takes an optional `credential` (the signed challenge, public key and RP ID) and `signal`, and may return `verified`. The `webAuthn` adapter passes its stored credential and makes later logins and disconnects wait for the verification.
