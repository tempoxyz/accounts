---
'accounts': patch
---

`Accounts.create` and `Accounts.from` throw `Accounts.ChainNameInvalidError` for a `chain` that is neither `mainnet`, `testnet`, nor a chain ID, such as `'localnet'` or `'1337'` from an environment variable, instead of creating an instance without a chain ID.
