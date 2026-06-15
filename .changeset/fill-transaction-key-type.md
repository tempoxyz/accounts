---
"accounts": patch
---

Fixed `eth_fillTransaction` to estimate gas for the signing key's signature size instead of always assuming secp256k1.
