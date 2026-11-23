---
'accounts': patch
---

Fixed `accounts.pay` to read no Tempo Account from Tempo ID for a session that signed in without one on an instance with `account: false`. The payment page picks the account, and outside a page the call throws `Actions.account.PageRequiredError` before any request.
