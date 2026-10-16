---
"accounts": patch
---

Apply `retryCount` to `wallet_revokeAccessKey` in request-based adapters (device code, CLI, postMessage, mobile web auth), which now send revocations through the same transport as other wallet requests. Device-code and CLI revocations are still sent once by default, on the chain named in the request context.
