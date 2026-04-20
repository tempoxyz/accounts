---
'accounts': patch
---

Fixed `feePayer: false` to correctly propagate through `resolveFeePayer` and `prepareTransactionRequest`, allowing per-request opt-out of fee payers.
