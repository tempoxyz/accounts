---
'accounts': patch
---

Changed `chainId` type in `wallet_authorizeAccessKey` parameters and `Adapter.authorizeAccessKey.Parameters` from `number` to `bigint` to match ox/viem's `KeyAuthorization.chainId`.
