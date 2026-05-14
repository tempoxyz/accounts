---
'accounts': patch
---

Fixed `local` and `turnkey` adapters dropping `publicKey` when preparing key authorizations, which caused the wallet to sign authorizations for a freshly-generated address instead of the caller-supplied one.
