---
"accounts": patch
---

Fixed `wallet_getCallsStatus` returning status 500 for pending transactions. Now returns status 100 when `eth_getTransactionReceipt` is null, allowing `waitForCallsStatus` to continue polling until inclusion.
