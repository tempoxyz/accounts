---
"accounts": patch
---

Added `feePayer.precheck` to `Handler.relay`. It receives a fill's `chainId` and `from` before the relay fills a sponsored variant. Returning `false` fills the transaction unsponsored right away, so a host that already knows it won't sponsor a sender (for example one without a session) skips the sponsored `eth_fillTransaction` and the `validate` call that would reject it. `validate` still approves each sponsored fill, an app's own fee payer URL is not prechecked, and neither are raw transactions.
