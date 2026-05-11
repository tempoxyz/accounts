---
'accounts': minor
---

**Breaking:** Made the `errors` capability opt-in on `Handler.relay`'s `eth_fillTransaction` so reverts now throw JSON-RPC errors by default unless `capabilities.errors: true` is set.
