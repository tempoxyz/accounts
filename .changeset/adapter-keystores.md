---
"accounts": minor
---

Added adapter-supplied default access-key keystores via `Adapter.Instance.accessKey.keystores` (with pure-JS `Keystore.p256`/`Keystore.secp256k1` factories used by the React Native and CLI adapters), deprecating `Adapter.Instance.generateAccessKey`.
