---
'accounts': patch
---

Fixed `Handler.relay` to treat the pre-emptive fee-token autoSwap as best-effort, falling back to the resolved `feeToken` instead of failing when the swap itself can't be filled.
