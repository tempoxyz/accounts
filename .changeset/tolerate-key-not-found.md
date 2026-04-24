---
"accounts": patch
---

Fixed `wallet_revokeAccessKey` in the local adapter crashing with `KeyNotFound` when the access key was only authorized locally and never registered on-chain via a transaction.
