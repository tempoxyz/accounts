---
"accounts": patch
---

Send device-code wallet requests once by default. A failed or timed-out request such as `eth_sendTransactionSync` or `wallet_revokeAccessKey` was retried up to three times, starting a new approval (and possibly a second transaction) on each attempt. Added `retryCount` to `deviceCode`, `cli`, and the CLI `Provider.create` to opt back into retries. Chain reads still retry.
