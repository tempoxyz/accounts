---
"accounts": patch
---

Merged original `eth_fillTransaction` request fields (calls, chainId, validBefore, key data, feePayer) into the chain's filled tx so sponsorship envelope serialization no longer throws `CallsEmptyError`.
