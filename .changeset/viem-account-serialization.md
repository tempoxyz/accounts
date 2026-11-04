---
'accounts': patch
---

Changed `TempoAccount.deserialize` to rebuild the account through Viem's `Account.deserialize`, and `TempoAccount.AddressMismatchError` to Viem's `Account.AddressMismatchError`. `AccessKey.toAccount` passes the key authorization to Viem directly.
