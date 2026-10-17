---
"accounts": patch
---

Added `prefetch` to `WebAuthnCeremony.server` and `WebAuthnCeremony.deferred`. It fetches a login and a registration challenge ahead of the ceremonies that use them, so their options are built locally instead of waiting for the server to store a challenge. Each challenge taken is replaced in the background. The `webAuthn` adapter's login with a known passkey uses a prefetched challenge (`takeChallenge`) instead of registering a random one. `Handler.webAuthn`'s `/register/options` issues a challenge without a `name` or `userId`, and `/register` then takes the ones sent with the credential.

`Handler.webAuthn`'s `/register/options` and `/login/options` now return the challenge `ttl` (seconds) alongside `options`, and `/register` rejects a login challenge.
