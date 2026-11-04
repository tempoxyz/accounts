---
'accounts': patch
---

Changed the message of a redirect's refused code exchange: a wrong, expired, or redeemed code now rejects with `Invalid code: the code is wrong, expired, or already redeemed. Start sign-in again.`, and the issuer's refusal as its `cause`.
