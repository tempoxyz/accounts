---
"accounts": patch
---

Added `postMessage()` and `tempoWalletPostMessage()` adapters, also available from `accounts/postMessage` as `postMessage` and `tempoWallet`. One provider holds one Wata postMessage session to one wallet window (a popup by default): the page mounts on the first request, sequential requests reuse it, and `wallet_disconnect` tears the session down.
