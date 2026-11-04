---
"accounts": patch
---

Require a successful transaction receipt before reporting success for locally signed `wallet_updateAccessKey` spending-limit updates. Pending and reverted receipts now return a non-retryable `-32002` error with the chain ID, receipt status and transaction hash, instead of appearing confirmed or causing default Viem clients to submit the update again.
