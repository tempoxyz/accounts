---
'accounts': patch
---

The `viem` plugin keeps the registration mark of an access key whose fill the chain refuses with `CallNotAllowed`, as it does for `SpendingLimitExceeded`. The next transaction of the access key then attaches no key authorization, and sends 2 requests in place of 7.
