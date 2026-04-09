---
'accounts': patch
---

Added `privateKey` support to `dangerous_secp256k1()` so wagmi configs could pin distinct signers per connector.
Added runtime and type regression coverage for the pinned private-key path.
