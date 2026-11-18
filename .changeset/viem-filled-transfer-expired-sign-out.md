---
'accounts': patch
---

Fixed the session of an expired access key outside a page, such as in an Expo app. A transaction without its gas, fees, or nonce, such as `token.transferSync({ amount, to, token })`, rejected with `Accounts.SignedOutError` but left the status `signedIn` and the session in the store. The rejection now starts the read of the session, which empties it, so the status changes to `signedOut`.
