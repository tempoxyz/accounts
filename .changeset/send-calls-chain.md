---
"accounts": patch
---

Keep `wallet_sendCalls` submission, response metadata, and status IDs on the requested chain, or the active chain captured when the request starts. Status polling now looks up the transaction on that chain even when the active chain differs or changes during submission.

Forward the captured transaction chain to automatic access-key authorization when no authorization chain is configured, so an active-chain switch during approval cannot change the authorization's chain. Explicit authorization `chainId` values, including `0n`, are preserved.
