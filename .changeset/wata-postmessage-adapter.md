---
"accounts": patch
---

Added `postMessage()` and `tempoWalletPostMessage()` adapters, also available from `accounts/postMessage` as `postMessage` and `tempoWallet`. One provider holds one Wata postMessage session to one wallet window, mounted in a hidden overlay iframe by default (or a popup where iframes can't work): the page surfaces while requests are pending, hides or closes once the queue drains, and remounts in a popup when the wallet reports its iframe occluded. `wallet_disconnect` tears the session down.
