---
'accounts': patch
---

Added the transaction's call targets as fallback fee-token candidates in `Handler.relay` so users transferring a token they hold can pay gas in that token without an autoSwap.
