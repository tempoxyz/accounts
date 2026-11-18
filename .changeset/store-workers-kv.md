---
'accounts': patch
---

Added `Store.workersKv` to `accounts/cloudflare`, a store in a Workers KV namespace. It sets neither `takeItem` nor `lock`, since KV is eventually consistent.
