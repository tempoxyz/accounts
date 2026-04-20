---
'accounts': patch
---

Added support for app-provided fee payer URLs in `Handler.relay`. The relay now proxies `eth_fillTransaction` through an external fee payer service when a URL is provided, and passes through sponsor metadata from the upstream response.
