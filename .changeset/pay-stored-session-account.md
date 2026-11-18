---
'accounts': patch
---

Changed `accounts.pay` without `account` to read the stored session before Tempo ID, so a new instance on a stored session, such as a server's for each request, pays with no account read. Outside a page, a call without a session now throws `Accounts.SignedOutError` before any request, in place of the `login_required` refusal of `GET /v1/account`.
