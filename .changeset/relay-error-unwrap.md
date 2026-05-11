---
'accounts': patch
---

Surfaced the underlying upstream JSON-RPC error from `Handler.relay` instead of viem's `RpcRequestError` wrapper, and forwarded `keyAuthorization` through `eth_fillTransaction` normalization.
