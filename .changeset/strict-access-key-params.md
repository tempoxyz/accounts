---
"accounts": patch
---

Added strict parameter validation for `wallet_authorizeAccessKey` and `wallet_connect` in dialog adapters. `limits` is now required when authorizing access keys through the dialog. Added `Remote.validateSearch` to validate search params with formatted error messages and automatic rejection via `remote.rejectAll`.
