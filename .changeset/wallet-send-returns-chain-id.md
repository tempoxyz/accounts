---
'accounts': patch
---

Added `chainId` to the `wallet_send` return value alongside `receipt` so callers can identify which chain the receipt belongs to.
