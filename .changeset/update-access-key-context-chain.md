---
"accounts": patch
---

Route `wallet_updateAccessKey` to the requested `chainId` for dialog, device-code, postMessage and mobile web auth adapters by carrying it in the request context, as `wallet_revokeAccessKey` does, instead of sending it only in params while the context names the active chain. Mobile web auth now forwards the request context (account and chain) to the wallet like the other Wata transports, which also fixes chain routing for its revocations. Other JSON-RPC adapters reject a `chainId` other than the active chain instead of updating on it.
