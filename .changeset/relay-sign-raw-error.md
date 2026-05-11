---
"accounts": patch
---

Fixed `Handler.relay()` to return an actionable error when `eth_signRawTransaction` is called without a fee payer configured, instead of forwarding to the RPC node which returns an opaque "Method not found".
