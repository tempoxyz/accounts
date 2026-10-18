---
"accounts": patch
---

`WebAuthnCeremony.deferred` now also answers a login with a known passkey as soon as its signature checks out against the stored public key, and verifies it with the server (`POST /login`) in the background. `verifyAuthentication` takes an optional `credential` (the signed challenge, public key and RP ID) and `signal`, and may return `verified`, which resolves `{ session }`. The `webAuthn` adapter passes its stored credential and makes later logins, sign-ups and disconnects wait for the verification. A refused login ends the session in place and drops the account. A login whose outcome stays unknown (it failed in transit, or a retry found its challenge consumed) ends the session in place and keeps the account. `WebAuthnCeremony.server`'s `verifyAuthentication` now returns only its declared fields.
