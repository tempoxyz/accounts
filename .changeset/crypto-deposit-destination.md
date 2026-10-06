---
"accounts": minor
---

Add an optional `destinationToken` to `wallet_deposit` for destination-aware crypto deposits. Keep the existing `token` source hint and omitted-parameter behavior unchanged. Callers must check the wallet host's destination support before using the new parameter.
