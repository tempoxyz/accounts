---
'accounts': patch
---

Fixed `feePayerUrl` to be used by default when configured — previously required `feePayer: true` on each transaction, now auto-applies unless explicitly opted out with `feePayer: false`.
