---
"accounts": patch
---

`Remote.validateSearch` now refuses `wallet_connect` with `capabilities.digest` even with `strict: false`, so a trusted route that answers with its own result can't sign a caller-supplied hash.
