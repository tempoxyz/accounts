---
'accounts': patch
---

Added an optional `memo` parameter to `wallet_send` that the wallet attaches to TIP-20 transfers and rejects with `InvalidParamsError` for non-TIP-20 tokens.
