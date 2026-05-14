---
'accounts': patch
---

Defaulted `Handler.auth({ trustProxy })` to `true` on Cloudflare Workers and appended a `trustProxy` / `origin` hint to "domain mismatch" / "uri mismatch" errors raised from `wallet_connect`.
