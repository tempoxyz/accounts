---
'accounts': patch
---

Added `keyType`, `keyId`, and `keyData` to the `transactionRequest` Zod schema so they survive decoding when callers (e.g. wagmi) include them on `eth_fillTransaction` / `eth_sendTransaction` / `eth_signTransaction` payloads.
