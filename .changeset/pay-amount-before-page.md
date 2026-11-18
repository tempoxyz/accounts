---
'accounts': patch
---

Fixed `accounts.pay` and `Actions.account.pay`, which opened the payment page for an `amount` that Tempo ID refuses, such as `-5`, `0`, or `1e3`. Such an amount now rejects with `Accounts.RequestError`, the code `invalid_request`, the `reason` `invalid_field`, and the field `amount`, before any read or page.
