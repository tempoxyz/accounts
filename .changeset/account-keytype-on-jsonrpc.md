---
'accounts': patch
---

Carried `keyType` through on non-signable json-rpc accounts so the viem/tempo transaction formatter can derive the correct `keyType`/`keyData` placeholder bytes during `eth_fillTransaction` gas estimation (notably for WebAuthn EOAs).
