---
"accounts": patch
---

Added `WebAuthnCeremony.deferred`, a `WebAuthnCeremony.server` variant that answers registration as soon as the passkey is created and verifies it with the server in the background, retrying requests that fail in transit. The `webAuthn` adapter makes logins and disconnects wait for that verification for up to 10 s, then cancels it, so it can't replace the session that follows. A registration whose server-parsed public key differs from the client's is refused, and one acknowledged without its session ends the session in place. If the server rejects the registration while the page is open, the adapter removes the account and its access keys and keeps the public key in storage; a later login with the passkey restores the account. `WebAuthnCeremony.server` now also ends its session on `wallet_disconnect` when passed as `ceremony`.
