---
'accounts': patch
---

`accounts.pay({ session })` now throws `Accounts.AccessKeyRequiredError` before any request when the session's access key on the payment's chain expired, instead of `Actions.account.PageRequiredError`.
