---
"accounts": patch
---

Reject `wallet_updateAccessKey` with `UnsupportedChainIdError` when `chainId` is not one of the provider's configured chains, instead of updating the key on the default chain. The request fails before any adapter or wallet approval runs and leaves local access-key state unchanged.
