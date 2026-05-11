---
'accounts': patch
---

Fixed `Handler.relay` forwarding `keyAuthorization` to `eth_fillTransaction` in the internal envelope shape instead of the RPC shape the chain expects.
