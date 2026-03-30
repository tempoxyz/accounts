---
"accounts": patch
---

Fixed `dialog` wagmi connector dropping `Provider.create` options like `authorizeAccessKey` and `feePayerUrl`. Now forwards all remaining options to `setup()`.
