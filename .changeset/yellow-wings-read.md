---
"accounts": patch
---

`Handler.relay`: Default `feeToken` to the chain's first configured
token on sponsored fills when neither the wallet nor the caller supplies
one, and re-inject it after `fill()` when the chain echoes `feeToken:
null`. Prevents sponsored transactions from being broadcast without a
`feeToken`.
