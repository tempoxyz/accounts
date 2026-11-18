---
'accounts': patch
---

Fixed `accounts.pay` and `Actions.account.pay` in a frame, whose Buy MACH opened the payment page again in the popup. The popup now opens the payment page with `method=mach`, which opens the deposit pages and Buy MACH at once.
