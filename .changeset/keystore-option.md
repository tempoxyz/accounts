---
"accounts": minor
---

Added a pluggable access-key `keystore` option to `Provider.create`. A keystore owns access-key material end to end via two hooks — `createKey()` and `toAccount()` — with an opaque, JSON-serializable handle the SDK persists verbatim, unlocking hardware-backed access keys (Secure Enclave / Android Keystore) and other custom key backends. Ships a `webCryptoP256` reference keystore under `accounts/keystore`. Existing `privateKey`/`keyPair` records hydrate unchanged.
