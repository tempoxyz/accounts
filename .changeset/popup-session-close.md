---
"accounts": patch
---

Close the postMessage popup session when its popup closes. A request sent within 250 ms after the previous popup closed (for example `eth_sendTransaction` right after `wallet_connect`) no longer reaches the closed window and fails; it opens a new popup instead.
