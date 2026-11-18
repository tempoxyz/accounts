---
'accounts': patch
---

Changed the `viem` plugin on a page to refuse a fill, an estimate, or the signature of a transaction of an expired access key before the request, when its retry renews the access key, so the node receives no transaction of that access key, and the renewal starts with three requests fewer. The refusal is the error `Plugins.viem.AccessKeyExpiredError`, matched by `name`, which a call that sends no transaction, such as `estimateGas`, rejects with.
