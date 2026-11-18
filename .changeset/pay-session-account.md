---
'accounts': patch
---

Fixed `accounts.pay` with `session` and `account`. A session without an access key on the payment's chain now throws `Accounts.AccessKeyRequiredError` before any request, as without `account`. An `account` other than the account of the session's access key throws `Accounts.RequestError` with the reason `invalid_field` and the field `account`.
