---
'accounts': patch
---

The `viem` plugin's limit retry reads the TIP-20 `transfer` or `transferWithMemo` of a transaction request, such as one that `transferSync` of `wagmi/tempo` sends. For a transfer above the whole limit, the new access key's limit is the old limit plus the amount, in place of the same limit. The retry also sends 1 request before the sign-in in place of 3.
