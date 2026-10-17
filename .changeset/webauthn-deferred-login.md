---
"accounts": patch
---

`WebAuthnCeremony.deferred` now also answers a login with a known passkey as soon as its signature checks out against the stored public key, and verifies it with the server (`POST /login`) in the background. `verifyAuthentication` takes an optional `credential` (the signed challenge, public key, RP ID and username) and `signal`, and may return `verified`. The `webAuthn` adapter passes its stored credential and makes later logins and disconnects wait for the verification. A refused login ends the session in place and drops the account. `WebAuthnCeremony.server`'s `verifyAuthentication` now returns only its declared fields.
