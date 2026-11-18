---
'accounts': patch
---

Changed `accounts.mpp({ session })` and `accounts.mpp.session()` to throw `Accounts.SignedOutError` before any request for a session whose access key expired. Before, the payer sent the request and signed with the expired access key, and the chain's refusal surfaced as a Viem gas estimation error.
