---
"accounts": patch
---

`tempoWallet` now uses the Wata `postMessage` transport (also exported from `accounts/postMessage`) and the bespoke-messenger `dialog` adapter is deprecated; added the lower-level `postMessage()` adapter, and per-transport `tempoWallet` variants now live on their subpaths (e.g. `accounts/mobileWebAuth`) instead of top-level aliases.
