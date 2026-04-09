---
'accounts': patch
---

Added `account` support to `dangerous_secp256k1()` so wagmi configs could pin distinct signers per connector.
Defaulted pinned-account connectors to in-memory provider storage and added a regression test.
