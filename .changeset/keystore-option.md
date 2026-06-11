---
"accounts": minor
---

Added an `accessKey` option group to `Provider.create` — `accessKey.keystore` for pluggable access-key keystores (defaulting to the built-in non-extractable WebCrypto P-256 keystore) and `accessKey.authorize` superseding the now-deprecated top-level `authorizeAccessKey`.
